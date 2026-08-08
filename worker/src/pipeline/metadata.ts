import Anthropic from "@anthropic-ai/sdk";
import { readdir, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config.js";
import { ffmpeg } from "../exec.js";
import { log } from "../log.js";
import type { Transcript } from "./transcribe.js";

const MODEL = "claude-opus-5";
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export interface ClipMetadata {
  hooks: string[];
  titles: string[];
  description: string;
  hashtags: string[];
}

const METADATA_SCHEMA = {
  type: "object",
  properties: {
    hooks: {
      type: "array",
      description: "3 to 5 description opening lines, strongest first.",
      items: { type: "string" },
    },
    titles: {
      type: "array",
      description: "5 title options, under 80 characters each, strongest first.",
      items: { type: "string" },
    },
    description: {
      type: "string",
      description: "2 to 4 sentences for the YouTube description body.",
    },
    hashtags: {
      type: "array",
      description: "4 to 8 hashtags without the # prefix, lowercase.",
      items: { type: "string" },
    },
  },
  required: ["hooks", "titles", "description", "hashtags"],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You write the YouTube metadata for one vertical short clip, from its transcript.

hooks — opening lines for the description. One line each, under 100 characters, standing alone.
titles — under 80 characters. This is what people see in the Shorts feed.
description — 2 to 4 sentences of body text that follows the hook.
hashtags — lowercase, no # prefix, no spaces.

Rules that apply to all of it:
- Ground everything in what is actually said in the transcript. Never invent claims, numbers, names or outcomes that are not there.
- No clickbait the clip does not pay off. A mild clip gets a specific mild title, not an oversold one.
- No emoji in titles. No ALL CAPS words. No surrounding quotation marks.
- Vary the angle across the options: a question, a flat claim, a surprising detail, a line lifted straight from the clip.
- Order strongest first.`;

let client: Anthropic | null = null;

function anthropic(): Anthropic {
  if (!config.anthropicApiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set on the worker.");
  }
  if (!client) client = new Anthropic({ apiKey: config.anthropicApiKey });
  return client;
}

/**
 * Deterministic fallback. Always returns something usable so a clip never
 * reaches review without a description — a model outage should not be able to
 * wedge the pipeline.
 */
function fallbackMetadata(text: string, sourceTitle: string | null): ClipMetadata {
  const sentence = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .find((s) => s.length > 20 && s.length < 100);

  const line = sentence ?? "A high-energy moment from the full video.";

  return {
    hooks: [line, "The part of the video worth 30 seconds of your time."],
    titles: [line.slice(0, 80), sourceTitle?.slice(0, 80) ?? "Clip"],
    description: sourceTitle ? `A clip from ${sourceTitle}.` : "A clip from a longer video.",
    hashtags: ["shorts", "clips"],
  };
}

export async function generateMetadata(
  transcript: Transcript | null,
  context: {
    sourceTitle: string | null;
    category?: string | null;
    rationale?: string | null;
  },
): Promise<ClipMetadata> {
  const text = (transcript?.text ?? "").trim();

  // Silence, music, or a pure action beat — nothing to write about.
  if (text.length < 25) return fallbackMetadata(text, context.sourceTitle);
  if (!config.anthropicApiKey) return fallbackMetadata(text, context.sourceTitle);

  const request = {
    model: MODEL,
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user" as const,
        content: [
          context.sourceTitle ? `Source video: ${context.sourceTitle}` : null,
          context.category ? `Moment type: ${context.category}` : null,
          context.rationale ? `Why this moment was picked: ${context.rationale}` : null,
          "Clip transcript:",
          text.slice(0, 4000),
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    output_config: {
      // Short creative text — low effort is plenty and keeps per-clip cost down.
      effort: "low" as const,
      format: { type: "json_schema" as const, schema: METADATA_SCHEMA },
    },
  };

  let response: Anthropic.Messages.Message;
  try {
    response = (await anthropic().beta.messages.create({
      ...request,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
    } as never)) as unknown as Anthropic.Messages.Message;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!/beta|fallback/i.test(message)) throw err;
    response = await anthropic().messages.create(request);
  }

  // A refusal is HTTP 200 with empty or partial content — check before reading.
  if (response.stop_reason === "refusal") {
    const details = (response as { stop_details?: { category?: string } | null })
      .stop_details;
    log.warn("Metadata generation declined", {
      category: details?.category ?? "unspecified",
    });
    return fallbackMetadata(text, context.sourceTitle);
  }

  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") return fallbackMetadata(text, context.sourceTitle);

  try {
    const parsed = JSON.parse(block.text) as Partial<ClipMetadata>;

    const clean = (xs: unknown, limit: number, max: number) =>
      (Array.isArray(xs) ? xs : [])
        .map((x) => String(x ?? "").trim())
        .filter((x) => x.length > 0 && x.length <= limit)
        // The schema cannot express maxItems, so clamp here.
        .slice(0, max);

    const hooks = clean(parsed.hooks, 160, 5);
    const titles = clean(parsed.titles, 100, 5);

    if (hooks.length === 0 && titles.length === 0) {
      return fallbackMetadata(text, context.sourceTitle);
    }

    const fallback = fallbackMetadata(text, context.sourceTitle);

    return {
      hooks: hooks.length > 0 ? hooks : fallback.hooks,
      titles: titles.length > 0 ? titles : fallback.titles,
      description: (parsed.description ?? "").trim() || fallback.description,
      hashtags: clean(parsed.hashtags, 40, 8)
        .map((h) => h.replace(/^#+/, "").replace(/\s+/g, "").toLowerCase())
        .filter((h) => h.length > 0),
    };
  } catch {
    return fallbackMetadata(text, context.sourceTitle);
  }
}

/**
 * Extracts candidate cover frames.
 *
 * `thumbnail` picks the most representative frame out of each batch it sees,
 * which beats grabbing frames at fixed offsets — those reliably land on motion
 * blur and mid-blink. The first second is skipped because it is often a fade
 * in from the previous scene.
 */
export async function extractCoverFrames(
  clipPath: string,
  clipDuration: number,
  workDir: string,
  count = 5,
): Promise<string[]> {
  const dir = join(workDir, "covers");
  await mkdir(dir, { recursive: true });

  const start = clipDuration > 3 ? 1 : 0;
  // Batch size chosen so `thumbnail` yields roughly `count` frames overall.
  const batch = Math.max(12, Math.floor(((clipDuration - start) * 25) / count));

  try {
    await ffmpeg(
      [
        "-ss",
        String(start),
        "-i",
        clipPath,
        "-vf",
        `thumbnail=${batch},scale=540:960`,
        "-frames:v",
        String(count),
        "-vsync",
        "vfr",
        join(dir, "cover-%02d.jpg"),
      ],
      5 * 60_000,
    );

    const files = (await readdir(dir)).filter((f) => f.endsWith(".jpg")).sort();
    return files.map((f) => join(dir, f));
  } catch (err) {
    log.warn("Cover frame extraction failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    await rm(dir, { recursive: true, force: true });
    return [];
  }
}
