import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { log } from "../log.js";
import { db } from "../db.js";
import type { Transcript } from "./transcribe.js";
import { textInWindow } from "./transcribe.js";

const MODEL = "claude-opus-5";
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export const FACTORS = [
  "hook",
  "emotional_intensity",
  "curiosity",
  "dialogue",
  "pacing",
  "visual_activity",
  "ending",
] as const;

export type Factor = (typeof FACTORS)[number];

export interface Candidate {
  /** Index into the array we sent, used to match responses back. */
  id: number;
  start: number;
  end: number;
  /** Audio energy above rolling baseline — a signal, not the verdict. */
  energy: number;
  /** Scene cuts inside the window; a proxy for visual activity. */
  cuts: number;
  text: string;
}

export interface ScoredCandidate extends Candidate {
  score: number;
  factors: Record<Factor, number>;
  rationale: string;
  category: string;
  hook: {
    /** Seconds into the window where the strongest opening actually is. */
    bestOpeningAt: number;
    /** Set when the strongest opening is not the window's start. */
    suggestion: string | null;
    line: string | null;
  };
}

const CANDIDATE_SCHEMA = {
  type: "object",
  properties: {
    moments: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "integer", description: "The candidate id you were given." },
          category: {
            type: "string",
            enum: [
              "funny",
              "argument",
              "surprise",
              "emotional",
              "action",
              "insight",
              "suspense",
              "reaction",
              "mundane",
            ],
          },
          factors: {
            type: "object",
            properties: {
              hook: { type: "integer" },
              emotional_intensity: { type: "integer" },
              curiosity: { type: "integer" },
              dialogue: { type: "integer" },
              pacing: { type: "integer" },
              visual_activity: { type: "integer" },
              ending: { type: "integer" },
            },
            required: [
              "hook",
              "emotional_intensity",
              "curiosity",
              "dialogue",
              "pacing",
              "visual_activity",
              "ending",
            ],
            additionalProperties: false,
          },
          rationale: {
            type: "string",
            description:
              "One or two sentences on what makes this work, citing what is actually said.",
          },
          best_opening_offset_seconds: {
            type: "number",
            description:
              "Seconds into the window where the strongest opening line begins. 0 if the window already opens strongest.",
          },
          restructure_suggestion: {
            type: "string",
            description:
              "Empty string if the window already opens on its strongest moment. Otherwise one sentence on how to reorder it.",
          },
          opening_line: {
            type: "string",
            description: "The line that should open the clip, quoted from the transcript.",
          },
        },
        required: [
          "id",
          "category",
          "factors",
          "rationale",
          "best_opening_offset_seconds",
          "restructure_suggestion",
          "opening_line",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["moments"],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You rate candidate moments cut from a longer video for use as vertical short-form clips.

For each candidate you get its position, how far its audio energy stands above the surrounding baseline, how many scene cuts it contains, and the transcript of what is said in it.

Rate each factor 0-100:
- hook: how strongly the first two seconds grab attention
- emotional_intensity: how much feeling is present (laughter, anger, shock, warmth)
- curiosity: how much it makes a viewer need to know what happens next
- dialogue: how sharp and quotable the speech is
- pacing: whether it moves, or drags and repeats
- visual_activity: inferred from scene cuts and what the speech implies is happening
- ending: whether it lands on a payoff rather than trailing off

Rules:
- Judge only what the transcript and signals actually show. Do not invent events.
- Be willing to rate things low. A candidate that is someone clearing their throat is mundane and should score in the teens. Most candidates in a long video are not good clips, and saying so is the useful part of this job.
- You are rating these against each other, within one video. Spread your ratings out — if everything lands between 70 and 90 the ranking carries no information.
- visual_activity is the weakest signal you have, since you cannot see the video. When the cut count and speech give you little to go on, rate it near 50 rather than guessing high.
- best_opening_offset_seconds: if the most arresting line comes later in the window, say where. This is how the clip gets restructured to open on its strongest beat.
- rationale: be concrete and quote the clip. "Strong opening claim, escalates, pays off on the last line" is useful. "This is engaging content" is not.

You are not predicting view counts and should not try. You are ranking these candidates against each other on craft.`;

let client: Anthropic | null = null;

function anthropic(): Anthropic {
  if (!config.anthropicApiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set on the worker.");
  }
  if (!client) client = new Anthropic({ apiKey: config.anthropicApiKey });
  return client;
}

/** Weights for collapsing the factor breakdown into one comparable number. */
const WEIGHTS: Record<Factor, number> = {
  hook: 0.26,
  curiosity: 0.18,
  emotional_intensity: 0.16,
  dialogue: 0.14,
  ending: 0.12,
  pacing: 0.1,
  // Deliberately low: without vision this is the model's weakest inference.
  visual_activity: 0.04,
};

export function compositeScore(factors: Record<Factor, number>): number {
  let total = 0;
  for (const factor of FACTORS) {
    const value = Number(factors[factor]);
    total += (Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 50) * WEIGHTS[factor];
  }
  return Number(total.toFixed(1));
}

/** Falls back to the audio signal alone when the model is unavailable. */
function unscored(candidates: Candidate[]): ScoredCandidate[] {
  const maxEnergy = Math.max(1, ...candidates.map((c) => c.energy));

  return candidates.map((c) => {
    const normalized = Math.round((c.energy / maxEnergy) * 60) + 20;
    const factors = Object.fromEntries(
      FACTORS.map((f) => [f, normalized]),
    ) as Record<Factor, number>;

    return {
      ...c,
      score: compositeScore(factors),
      factors,
      rationale: "Ranked on audio energy only — moment scoring was unavailable.",
      category: "unrated",
      hook: { bestOpeningAt: 0, suggestion: null, line: null },
    };
  });
}

/**
 * Scores every candidate in one call.
 *
 * One request rather than one per candidate: a 2-hour source can yield 40
 * candidates, and the model rates them far more consistently when it can see
 * them side by side — which is the whole point of a *relative* ranking.
 */
export async function scoreCandidates(
  candidates: Candidate[],
  context: { sourceTitle: string | null; styleProfile: unknown | null },
): Promise<ScoredCandidate[]> {
  if (candidates.length === 0) return [];
  if (!config.anthropicApiKey) return unscored(candidates);

  const lines = candidates.map(
    (c) =>
      `id=${c.id} at=${Math.floor(c.start / 60)}m${String(Math.floor(c.start % 60)).padStart(2, "0")}s ` +
      `length=${(c.end - c.start).toFixed(0)}s energy=+${c.energy.toFixed(1)}dB cuts=${c.cuts}\n` +
      `transcript: ${c.text.length > 0 ? c.text.slice(0, 900) : "(no speech)"}`,
  );

  const styleNote =
    context.styleProfile && Object.keys(context.styleProfile).length > 0
      ? `\n\nThis operator's observed preferences, learned from what they kept and rejected before. Weigh these, but do not let them override an obviously weak candidate:\n${JSON.stringify(context.styleProfile)}`
      : "";

  const request = {
    model: MODEL,
    max_tokens: 32000,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user" as const,
        content:
          (context.sourceTitle ? `Source: ${context.sourceTitle}\n\n` : "") +
          `${candidates.length} candidates:\n\n${lines.join("\n\n")}${styleNote}`,
      },
    ],
    output_config: {
      effort: "medium" as const,
      format: { type: "json_schema" as const, schema: CANDIDATE_SCHEMA },
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

  // A refusal is HTTP 200 with empty or partial content.
  if (response.stop_reason === "refusal") {
    const details = (response as { stop_details?: { category?: string } | null })
      .stop_details;
    log.warn("Moment scoring declined", {
      category: details?.category ?? "unspecified",
    });
    return unscored(candidates);
  }

  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") return unscored(candidates);

  let parsed: {
    moments?: Array<{
      id?: number;
      category?: string;
      factors?: Record<string, number>;
      rationale?: string;
      best_opening_offset_seconds?: number;
      restructure_suggestion?: string;
      opening_line?: string;
    }>;
  };

  try {
    parsed = JSON.parse(block.text);
  } catch {
    return unscored(candidates);
  }

  const byId = new Map(candidates.map((c) => [c.id, c]));
  const scored: ScoredCandidate[] = [];

  for (const moment of parsed.moments ?? []) {
    const candidate = byId.get(Number(moment.id));
    if (!candidate) continue;

    const factors = Object.fromEntries(
      FACTORS.map((f) => {
        const raw = Number(moment.factors?.[f]);
        return [f, Number.isFinite(raw) ? Math.max(0, Math.min(100, Math.round(raw))) : 50];
      }),
    ) as Record<Factor, number>;

    const offset = Number(moment.best_opening_offset_seconds);
    const suggestion = (moment.restructure_suggestion ?? "").trim();

    scored.push({
      ...candidate,
      score: compositeScore(factors),
      factors,
      rationale: (moment.rationale ?? "").trim(),
      category: moment.category ?? "unrated",
      hook: {
        bestOpeningAt:
          Number.isFinite(offset) && offset > 0.5
            ? Number(Math.min(offset, candidate.end - candidate.start - 3).toFixed(2))
            : 0,
        suggestion: suggestion.length > 0 ? suggestion : null,
        line: (moment.opening_line ?? "").trim() || null,
      },
    });
  }

  // Anything the model skipped still deserves a place, ranked on audio alone.
  const returned = new Set(scored.map((s) => s.id));
  for (const missing of candidates.filter((c) => !returned.has(c.id))) {
    scored.push(...unscored([missing]));
  }

  return scored.sort((a, b) => b.score - a.score);
}

/**
 * Builds the candidate list from the raw signals.
 *
 * Peaks alone miss quiet-but-loaded moments, and scene starts alone miss
 * everything in a single-camera stream — so both feed in, deduplicated by
 * overlap. Roughly 3x the target count goes to the scorer, which then does
 * the actual selecting.
 */
export function buildCandidateWindows(options: {
  peaks: Array<{ start: number; end: number; score: number }>;
  scenes: Array<{ start: number; end: number }>;
  transcript: Transcript;
  durationSeconds: number;
  clipLength: number;
  want: number;
}): Candidate[] {
  const { peaks, scenes, transcript, durationSeconds, clipLength, want } = options;
  const target = Math.max(6, want * 3);

  const windows: Array<{ start: number; end: number; energy: number }> = peaks.map(
    (p) => ({ start: p.start, end: p.end, energy: p.score }),
  );

  // Scene-aligned windows, for structure the audio picker cannot see.
  for (const scene of scenes) {
    if (windows.length >= target) break;
    if (scene.end - scene.start < clipLength * 0.5) continue;

    const start = scene.start;
    const end = Math.min(start + clipLength, durationSeconds, scene.end);
    if (end - start < clipLength * 0.6) continue;

    const overlaps = windows.some((w) => start < w.end && end > w.start);
    if (overlaps) continue;

    windows.push({ start, end, energy: 0 });
  }

  return windows.slice(0, target).map((w, i) => ({
    id: i,
    start: Number(w.start.toFixed(2)),
    end: Number(w.end.toFixed(2)),
    energy: w.energy,
    cuts: scenes.filter((s) => s.start > w.start && s.start < w.end).length,
    text: textInWindow(transcript, w.start, w.end),
  }));
}

/**
 * Refreshes the operator's style profile from what they have kept and
 * rejected. This is accumulated preference used as scoring context, not a
 * trained model — the naming reflects that.
 */
export async function refreshStyleProfile(ownerId: string): Promise<void> {
  const { data } = await db
    .from("clips")
    .select("library_status, score, score_factors, category, start_seconds, end_seconds, caption_preset")
    .eq("owner_id", ownerId)
    .in("library_status", ["shortlisted", "exported", "published", "rejected"])
    .limit(400);

  const rows = (data ?? []) as Array<{
    library_status: string;
    score: number | null;
    score_factors: Record<string, number> | null;
    category: string | null;
    start_seconds: number;
    end_seconds: number;
    caption_preset: string;
  }>;

  // Below this there is no signal, only noise from a handful of clicks.
  if (rows.length < 8) return;

  const kept = rows.filter((r) => r.library_status !== "rejected");
  const rejected = rows.filter((r) => r.library_status === "rejected");
  if (kept.length === 0) return;

  const mean = (xs: number[]) =>
    xs.length === 0 ? null : Number((xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1));

  const categoryCounts: Record<string, number> = {};
  for (const r of kept) {
    const key = r.category ?? "unrated";
    categoryCounts[key] = (categoryCounts[key] ?? 0) + 1;
  }

  const presetCounts: Record<string, number> = {};
  for (const r of kept) {
    presetCounts[r.caption_preset] = (presetCounts[r.caption_preset] ?? 0) + 1;
  }

  const factorMeans: Record<string, number | null> = {};
  for (const factor of FACTORS) {
    factorMeans[factor] = mean(
      kept.map((r) => Number(r.score_factors?.[factor])).filter((n) => Number.isFinite(n)),
    );
  }

  const profile = {
    average_kept_length_seconds: mean(kept.map((r) => r.end_seconds - r.start_seconds)),
    average_kept_score: mean(kept.map((r) => Number(r.score)).filter(Number.isFinite)),
    average_rejected_score: mean(
      rejected.map((r) => Number(r.score)).filter(Number.isFinite),
    ),
    preferred_categories: Object.entries(categoryCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([k]) => k),
    preferred_caption_preset:
      Object.entries(presetCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
    factor_means_of_kept_clips: factorMeans,
  };

  await db.from("style_profiles").upsert({
    owner_id: ownerId,
    profile,
    sample_size: rows.length,
    updated_at: new Date().toISOString(),
  });

  log.info("Style profile refreshed", { ownerId, sampleSize: rows.length });
}
