import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { run } from "../exec.js";
import type { Transcript, TranscriptWord } from "./transcribe.js";

/** Word-by-word sweep vs. whole-line. Orthogonal to the visual preset. */
export type CaptionStyle = "karaoke" | "static";

/** The visual look. */
export type CaptionPreset = "clean" | "punch" | "cinematic" | "minimal";

export const CAPTION_PRESETS: CaptionPreset[] = [
  "clean",
  "punch",
  "cinematic",
  "minimal",
];

/**
 * ASS colours are &HAABBGGRR — byte-reversed from hex, and alpha is inverted
 * (00 is opaque). Getting this backwards is the classic ASS bug, so every
 * colour is written out once here and never inlined.
 */
const WHITE = "&H00FFFFFF";
const AMBER = "&H003BA9F0"; // #F0A93B
const OUTLINE_DARK = "&H00121820";
const SHADOW = "&H96000000";
const NO_SHADOW = "&H00000000";

interface PresetSpec {
  font: string;
  size: number;
  primary: string;
  /** Karaoke: colour before the sweep reaches a word. */
  secondary: string;
  outline: string;
  outlineWidth: number;
  shadow: number;
  shadowColour: string;
  bold: number;
  spacing: number;
  /** Bottom margin — lifts captions clear of the Shorts UI overlay. */
  marginV: number;
  uppercase: boolean;
  maxWords: number;
  maxChars: number;
  /** Scale applied to an emphasised word, via \fscx/\fscy. */
  emphasisScale: number;
  emphasisColour: string;
}

const SPECS: Record<CaptionPreset, PresetSpec> = {
  // Neutral, legible, gets out of the way.
  clean: {
    font: "DejaVu Sans",
    size: 84,
    primary: WHITE,
    secondary: WHITE,
    outline: OUTLINE_DARK,
    outlineWidth: 6,
    shadow: 2,
    shadowColour: SHADOW,
    bold: -1,
    spacing: 0,
    marginV: 420,
    uppercase: false,
    maxWords: 6,
    maxChars: 30,
    emphasisScale: 112,
    emphasisColour: AMBER,
  },
  // Loud, tight, all-caps — the meme register.
  punch: {
    font: "DejaVu Sans",
    size: 112,
    primary: WHITE,
    secondary: WHITE,
    outline: OUTLINE_DARK,
    outlineWidth: 9,
    shadow: 0,
    shadowColour: NO_SHADOW,
    bold: -1,
    spacing: 1,
    marginV: 520,
    uppercase: true,
    maxWords: 3,
    maxChars: 16,
    emphasisScale: 130,
    emphasisColour: AMBER,
  },
  // Centred, larger, no shout — for dialogue that carries itself.
  cinematic: {
    font: "DejaVu Serif",
    size: 76,
    primary: WHITE,
    secondary: WHITE,
    outline: OUTLINE_DARK,
    outlineWidth: 3,
    shadow: 4,
    shadowColour: SHADOW,
    bold: 0,
    spacing: 2,
    marginV: 780,
    uppercase: false,
    maxWords: 8,
    maxChars: 36,
    emphasisScale: 100,
    emphasisColour: WHITE,
  },
  // Small, low, unobtrusive.
  minimal: {
    font: "DejaVu Sans",
    size: 54,
    primary: WHITE,
    secondary: WHITE,
    outline: OUTLINE_DARK,
    outlineWidth: 3,
    shadow: 1,
    shadowColour: SHADOW,
    bold: 0,
    spacing: 0,
    marginV: 300,
    uppercase: false,
    maxWords: 9,
    maxChars: 42,
    emphasisScale: 100,
    emphasisColour: WHITE,
  },
};

/** ASS timestamps are H:MM:SS.cc — centiseconds, single-digit hour. */
function assTime(seconds: number): string {
  const total = Math.max(0, seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const cs = Math.round((total % 1) * 100);
  // Rounding centiseconds can carry to 100; normalise rather than emit "60.100".
  const carry = cs === 100 ? 1 : 0;
  return `${h}:${String(m).padStart(2, "0")}:${String(s + carry).padStart(2, "0")}.${String(carry ? 0 : cs).padStart(2, "0")}`;
}

/** Braces and backslashes are ASS override syntax — neutralise them. */
function escapeText(text: string): string {
  return text
    .replace(/\\/g, "∖")
    .replace(/\{/g, "(")
    .replace(/\}/g, ")")
    .replace(/\r?\n/g, " ");
}

/**
 * Words that carry no meaning on their own and should never be the emphasised
 * word in a line.
 */
const STOPWORDS = new Set([
  "a","an","the","and","or","but","if","so","of","to","in","on","at","for","with",
  "is","are","was","were","be","been","am","do","does","did","have","has","had",
  "i","you","he","she","it","we","they","me","him","her","us","them","my","your",
  "this","that","these","those","there","here","then","than","as","just","like",
  "not","no","yes","okay","ok","well","oh","um","uh","gonna","really","very",
]);

/**
 * Picks the word in a line to emphasise.
 *
 * Ranked by signals that survive having no audio analysis per word: explicit
 * punctuation, an unusually long hold on the word (people stretch the word
 * they mean), negations, and length. Returns -1 when nothing stands out —
 * emphasising an arbitrary word is worse than emphasising none.
 */
export function pickEmphasis(words: TranscriptWord[]): number {
  let best = -1;
  let bestScore = 0;

  for (let i = 0; i < words.length; i++) {
    const raw = words[i].word;
    const bare = raw.replace(/[^\p{L}\p{N}']/gu, "").toLowerCase();
    if (bare.length === 0 || STOPWORDS.has(bare)) continue;

    let score = Math.min(bare.length, 12) * 0.5;

    // Held longer than its neighbours — usually the stressed word.
    const duration = words[i].end - words[i].start;
    const average =
      words.reduce((a, w) => a + (w.end - w.start), 0) / Math.max(1, words.length);
    if (average > 0 && duration > average * 1.5) score += 5;

    if (/[!?]$/.test(raw)) score += 4;
    if (/^[A-Z]{2,}$/.test(bare.toUpperCase()) && raw === raw.toUpperCase()) score += 2;
    if (["never","nothing","nobody","everything","everyone","always","what","why","how"].includes(bare)) {
      score += 3;
    }

    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }

  // Below this the "emphasis" is just the longest word, which reads as random.
  return bestScore >= 5 ? best : -1;
}

export interface CaptionLine {
  words: TranscriptWord[];
  start: number;
  end: number;
}

export function groupIntoLines(
  words: TranscriptWord[],
  opts: { maxWords: number; maxChars: number },
): CaptionLine[] {
  const lines: CaptionLine[] = [];
  let current: TranscriptWord[] = [];

  const flush = () => {
    if (current.length === 0) return;
    lines.push({
      words: current,
      start: current[0].start,
      end: current[current.length - 1].end,
    });
    current = [];
  };

  for (const word of words) {
    const charCount = current.reduce((n, w) => n + w.word.length + 1, 0);
    const gap = current.length > 0 ? word.start - current[current.length - 1].end : 0;

    if (
      current.length >= opts.maxWords ||
      charCount + word.word.length > opts.maxChars ||
      // A real pause is a natural line break.
      gap > 0.7
    ) {
      flush();
    }

    current.push(word);
    if (/[.!?]$/.test(word.word)) flush();
  }

  flush();
  return lines;
}

function header(preset: CaptionPreset, style: CaptionStyle): string {
  const spec = SPECS[preset];

  // Karaoke sweeps: Secondary is "not yet spoken", Primary is "spoken".
  const primary = style === "karaoke" ? AMBER : spec.primary;
  const secondary = style === "karaoke" ? spec.secondary : spec.primary;

  // Alignment 2 = bottom-centre, 5 = top-centre. Cinematic sits higher via a
  // large MarginV rather than a different anchor, so it still reads bottom-up.
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    "PlayResX: 1080",
    "PlayResY: 1920",
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "YCbCr Matrix: TV.709",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Nexus,${spec.font},${spec.size},${primary},${secondary},${spec.outline},${spec.shadowColour},${spec.bold},0,0,0,100,100,${spec.spacing},0,1,${spec.outlineWidth},${spec.shadow},2,90,90,${spec.marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ].join("\n");
}

function renderWord(word: string, spec: PresetSpec, emphasised: boolean): string {
  const text = escapeText(spec.uppercase ? word.toUpperCase() : word);
  if (!emphasised) return text;

  // Reset after the word so emphasis does not bleed into the rest of the line.
  const scale =
    spec.emphasisScale === 100
      ? ""
      : `\\fscx${spec.emphasisScale}\\fscy${spec.emphasisScale}`;
  const colour = spec.emphasisColour === spec.primary ? "" : `\\c${spec.emphasisColour}`;
  if (!scale && !colour) return text;

  return `{${scale}${colour}}${text}{\\fscx100\\fscy100\\c${spec.primary}}`;
}

/** Word-by-word: one event per line, with a \k sweep per word. */
function karaokeEvents(lines: CaptionLine[], spec: PresetSpec): string[] {
  return lines.map((line) => {
    let cursor = line.start;
    const emphasis = pickEmphasis(line.words);
    const parts: string[] = [];

    for (let i = 0; i < line.words.length; i++) {
      const word = line.words[i];

      // A gap before the word still has to be consumed by the sweep, or the
      // highlight drifts out of sync over a long line.
      const lead = Math.max(0, Math.round((word.start - cursor) * 100));
      if (lead > 0) parts.push(`{\\k${lead}}`);

      const held = Math.max(1, Math.round((word.end - word.start) * 100));
      parts.push(`{\\kf${held}}${renderWord(word.word, spec, i === emphasis)} `);
      cursor = word.end;
    }

    return `Dialogue: 0,${assTime(line.start)},${assTime(line.end)},Nexus,,0,0,0,,${parts.join("")}`;
  });
}

/** Static: the whole line appears at once and holds. */
function staticEvents(lines: CaptionLine[], spec: PresetSpec): string[] {
  return lines.map((line, i) => {
    const emphasis = pickEmphasis(line.words);
    const text = line.words
      .map((w, j) => renderWord(w.word, spec, j === emphasis))
      .join(" ");

    // Hold each line until the next starts so there is no dead frame.
    const next = lines[i + 1];
    const end = next ? Math.min(next.start, line.end + 1.2) : line.end + 0.4;
    return `Dialogue: 0,${assTime(line.start)},${assTime(end)},Nexus,,0,0,0,,${text}`;
  });
}

export function buildAss(
  transcript: Transcript,
  style: CaptionStyle,
  preset: CaptionPreset = "clean",
): string {
  const spec = SPECS[preset];
  const words = transcript.words ?? [];
  if (words.length === 0) return header(preset, style);

  const lines = groupIntoLines(words, {
    // Karaoke reads a couple of words tighter than the same preset static.
    maxWords: style === "karaoke" ? Math.max(2, spec.maxWords - 2) : spec.maxWords,
    maxChars: style === "karaoke" ? Math.round(spec.maxChars * 0.72) : spec.maxChars,
  });

  const events =
    style === "karaoke" ? karaokeEvents(lines, spec) : staticEvents(lines, spec);

  return `${header(preset, style)}\n${events.join("\n")}\n`;
}

/**
 * Burns captions in.
 *
 * Audio is stream-copied; only the video is re-encoded, since the subtitle
 * filter is the only thing that changed.
 */
export async function burnCaptions(
  videoPath: string,
  transcript: Transcript,
  style: CaptionStyle,
  workDir: string,
  preset: CaptionPreset = "clean",
): Promise<string> {
  const assName = `captions-${preset}-${style}.ass`;
  const outputName = `captioned-${preset}-${style}.mp4`;

  await writeFile(join(workDir, assName), buildAss(transcript, style, preset), "utf8");

  // Run from workDir so the filter argument is a bare filename — ffmpeg's
  // filter parser treats ':' and '\' in paths as syntax, and absolute paths
  // need fragile double-escaping to survive it.
  await run(
    "ffmpeg",
    [
      "-hide_banner",
      "-nostdin",
      "-y",
      "-i",
      videoPath,
      "-vf",
      `ass=${assName}`,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "20",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "copy",
      "-movflags",
      "+faststart",
      outputName,
    ],
    { cwd: workDir, timeoutMs: 15 * 60_000 },
  );

  return join(workDir, outputName);
}
