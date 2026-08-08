import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { log } from "../log.js";
import type { Transcript } from "./transcribe.js";

const MODEL = "claude-opus-5";
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

const HOOK_SCHEMA = {
  type: "object",
  properties: {
    hooks: {
      type: "array",
      description: "Between 3 and 5 hook lines, strongest first.",
      items: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "One hook line. No hashtags, no emoji, no quotes.",
          },
        },
        required: ["text"],
        additionalProperties: false,
      },
    },
  },
  required: ["hooks"],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You write opening lines for YouTube Shorts descriptions.

You are given the transcript of one ~30 second vertical clip. Write hook lines that make someone reading the description want to watch the clip.

Rules:
- Each hook is one line, under 100 characters, and stands alone.
- Ground every hook in something actually said in the transcript. Do not invent claims, numbers, names, or outcomes that are not there.
- No hashtags, no emoji, no all-caps, no surrounding quotation marks.
- No clickbait that the clip does not pay off. If the clip is mild, write a hook that is mild and specific rather than one that oversells.
- Vary the angle across the options: a question, a claim, a surprising detail, a line lifted from the clip itself.
- Order them strongest first.

Return 3 to 5 options.`;

let client: Anthropic | null = null;

function anthropic(): Anthropic {
  if (!config.anthropicApiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set on the worker.");
  }
  if (!client) client = new Anthropic({ apiKey: config.anthropicApiKey });
  return client;
}

function fallbackHooks(text: string): string[] {
  const sentence = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .find((s) => s.length > 20 && s.length < 100);

  return [
    sentence ?? "A high-energy moment from the full video.",
    "The part of the video worth 30 seconds of your time.",
  ];
}

/**
 * Stage 7 — Hook generation.
 *
 * Always returns at least one usable line: a clip that reaches review without
 * a description is a clip the operator cannot act on, and a model outage
 * should not be able to wedge the pipeline.
 */
export async function generateHooks(
  transcript: Transcript | null,
  sourceTitle: string | null,
): Promise<string[]> {
  const text = (transcript?.text ?? "").trim();

  // Silence, music, or a pure action beat — nothing to write a hook about.
  if (text.length < 25) return fallbackHooks(text);

  const request = {
    model: MODEL,
    max_tokens: 4000,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user" as const,
        content: [
          sourceTitle ? `Source video title: ${sourceTitle}` : null,
          "Clip transcript:",
          text,
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    output_config: {
      // Short creative text — low effort keeps per-clip cost and latency down.
      effort: "low" as const,
      format: { type: "json_schema" as const, schema: HOOK_SCHEMA },
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
    // stop_details is not in this SDK version's Message type yet; it is
    // present on the wire whenever stop_reason is "refusal".
    const details = (response as { stop_details?: { category?: string } | null })
      .stop_details;
    log.warn("Hook generation declined", {
      category: details?.category ?? "unspecified",
    });
    return fallbackHooks(text);
  }

  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") return fallbackHooks(text);

  try {
    const parsed = JSON.parse(block.text) as { hooks?: Array<{ text?: string }> };
    const hooks = (parsed.hooks ?? [])
      .map((h) => (h.text ?? "").trim())
      .filter((h) => h.length > 0)
      // The schema cannot express maxItems, so clamp here.
      .slice(0, 5);

    return hooks.length > 0 ? hooks : fallbackHooks(text);
  } catch {
    return fallbackHooks(text);
  }
}
