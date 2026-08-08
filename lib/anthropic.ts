import Anthropic from "@anthropic-ai/sdk";
import type { Transcript } from "@/lib/types";

const MODEL = "claude-opus-5";

/**
 * Server-side refusal fallbacks. On a policy decline the API re-serves the
 * request on Anthropic's recommended fallback model inside the same call,
 * rather than handing us an empty response. If the beta is not enabled on the
 * account we transparently retry without it (see generateHooks).
 */
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
            description:
              "One hook line. No hashtags, no emoji, no surrounding quotes.",
          },
        },
        required: ["text"],
        additionalProperties: false,
      },
    },
  },
  required: ["hooks"],
  additionalProperties: false,
} as const;

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

export interface GeneratedHooks {
  hooks: string[];
  /** Set when the model declined; the caller falls back to a transcript line. */
  refusalCategory?: string;
}

function client(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Hook generation is unavailable.",
    );
  }
  return new Anthropic({ apiKey });
}

function transcriptText(transcript: Transcript | null): string {
  if (!transcript) return "";
  if (transcript.text?.trim()) return transcript.text.trim();
  return (transcript.words ?? []).map((w) => w.word).join(" ").trim();
}

/**
 * Deterministic fallback used when the transcript is unusable or the model
 * declines. Always returns something so a clip is never stuck without a
 * description — the operator can still edit it before it goes out.
 */
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

export async function generateHooks(
  transcript: Transcript | null,
  context?: { sourceTitle?: string | null },
): Promise<GeneratedHooks> {
  const text = transcriptText(transcript);

  // Nothing was said in this window — a music or action beat. No point asking
  // the model to write a hook about silence.
  if (text.length < 25) {
    return { hooks: fallbackHooks(text) };
  }

  const anthropic = client();

  const userContent = [
    context?.sourceTitle ? `Source video title: ${context.sourceTitle}` : null,
    "Clip transcript:",
    text,
  ]
    .filter(Boolean)
    .join("\n\n");

  const request = {
    model: MODEL,
    max_tokens: 4000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user" as const, content: userContent }],
    output_config: {
      // Short creative text — low effort is plenty here and keeps the
      // per-clip cost and latency down.
      effort: "low" as const,
      format: { type: "json_schema" as const, schema: HOOK_SCHEMA },
    },
  };

  let response: Anthropic.Messages.Message;
  try {
    response = (await anthropic.beta.messages.create({
      ...request,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
    } as never)) as unknown as Anthropic.Messages.Message;
  } catch (err) {
    // The refusal-fallback beta is not enabled on every account. Fall back to
    // the plain endpoint rather than failing the clip.
    const message = err instanceof Error ? err.message : String(err);
    if (!/beta|fallback/i.test(message)) throw err;
    response = await anthropic.messages.create(request);
  }

  // Check stop_reason before touching content: a refusal returns HTTP 200 with
  // empty or partial content, so indexing content[0] blindly would throw.
  if (response.stop_reason === "refusal") {
    // stop_details is not in this SDK version's Message type yet; it is
    // present on the wire whenever stop_reason is "refusal".
    const details = (response as { stop_details?: { category?: string } | null })
      .stop_details;
    return {
      hooks: fallbackHooks(text),
      refusalCategory: details?.category ?? "unspecified",
    };
  }

  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") {
    return { hooks: fallbackHooks(text) };
  }

  let parsed: { hooks?: Array<{ text?: string }> };
  try {
    parsed = JSON.parse(block.text);
  } catch {
    return { hooks: fallbackHooks(text) };
  }

  const hooks = (parsed.hooks ?? [])
    .map((h) => (h.text ?? "").trim())
    .filter((h) => h.length > 0)
    // The schema cannot express minItems/maxItems, so clamp here.
    .slice(0, 5);

  return { hooks: hooks.length > 0 ? hooks : fallbackHooks(text) };
}
