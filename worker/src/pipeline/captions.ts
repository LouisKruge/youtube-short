import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { run } from "../exec.js";
import type { Transcript, TranscriptWord } from "./transcribe.js";

export type CaptionStyle = "karaoke" | "static";

/**
 * ASS colours are &HAABBGGRR — byte-reversed from hex, and alpha is
 * inverted (00 is opaque). Getting this backwards is the classic ASS bug,
 * so the palette is written out once here and never inlined.
 */
const WHITE = "&H00FFFFFF";
const AMBER = "&H003BA9F0"; // #F0A93B
const OUTLINE = "&H00121820";
const SHADOW = "&H96000000";

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

export interface CaptionLine {
  words: TranscriptWord[];
  start: number;
  end: number;
}

/**
 * Groups words into readable lines. Vertical video is narrow, so lines stay
 * short — long lines wrap unpredictably and cover the subject.
 */
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

    // Break on a real pause even mid-line — it reads as a natural beat.
    const gap = current.length > 0 ? word.start - current[current.length - 1].end : 0;

    if (
      current.length >= opts.maxWords ||
      charCount + word.word.length > opts.maxChars ||
      gap > 0.7
    ) {
      flush();
    }

    current.push(word);

    // End the line on sentence punctuation.
    if (/[.!?]$/.test(word.word)) flush();
  }

  flush();
  return lines;
}

function header(style: CaptionStyle): string {
  // Karaoke sweeps white -> amber, so Secondary is the "not yet spoken" state.
  // Static has no sweep, so Primary is simply the text colour.
  const primary = style === "karaoke" ? AMBER : WHITE;
  const secondary = style === "karaoke" ? WHITE : WHITE;
  const fontSize = style === "karaoke" ? 96 : 78;

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
    // Alignment 2 = bottom-centre; MarginV lifts captions clear of the
    // YouTube Shorts UI overlay along the bottom of the frame.
    `Style: Nexus,DejaVu Sans,${fontSize},${primary},${secondary},${OUTLINE},${SHADOW},-1,0,0,0,100,100,2,0,1,7,3,2,90,90,420,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ].join("\n");
}

/** Word-by-word: one event per line, with a \k sweep per word. */
function karaokeEvents(lines: CaptionLine[]): string[] {
  return lines.map((line) => {
    let cursor = line.start;
    const parts: string[] = [];

    for (const word of line.words) {
      // A gap before the word still has to be consumed by the sweep, or the
      // highlight drifts out of sync with the audio over a long line.
      const lead = Math.max(0, Math.round((word.start - cursor) * 100));
      if (lead > 0) parts.push(`{\\k${lead}}`);

      const held = Math.max(1, Math.round((word.end - word.start) * 100));
      parts.push(`{\\kf${held}}${escapeText(word.word)} `);
      cursor = word.end;
    }

    return `Dialogue: 0,${assTime(line.start)},${assTime(line.end)},Nexus,,0,0,0,,${parts.join("")}`;
  });
}

/** Static: the whole line appears at once and holds. */
function staticEvents(lines: CaptionLine[]): string[] {
  return lines.map((line, i) => {
    const text = escapeText(line.words.map((w) => w.word).join(" "));
    // Hold each line until the next one starts so there is no dead frame.
    const next = lines[i + 1];
    const end = next ? Math.min(next.start, line.end + 1.2) : line.end + 0.4;
    return `Dialogue: 0,${assTime(line.start)},${assTime(end)},Nexus,,0,0,0,,${text}`;
  });
}

export function buildAss(transcript: Transcript, style: CaptionStyle): string {
  const words = transcript.words ?? [];
  if (words.length === 0) return header(style);

  const lines =
    style === "karaoke"
      ? groupIntoLines(words, { maxWords: 4, maxChars: 22 })
      : groupIntoLines(words, { maxWords: 8, maxChars: 38 });

  const events = style === "karaoke" ? karaokeEvents(lines) : staticEvents(lines);
  return `${header(style)}\n${events.join("\n")}\n`;
}

/**
 * Stage 6 — Caption burn-in.
 *
 * Audio is stream-copied; only the video is re-encoded, since the subtitle
 * filter is the only thing that changed.
 */
export async function burnCaptions(
  videoPath: string,
  transcript: Transcript,
  style: CaptionStyle,
  workDir: string,
): Promise<string> {
  const assName = `captions-${style}.ass`;
  const outputName = `captioned-${style}.mp4`;

  await writeFile(join(workDir, assName), buildAss(transcript, style), "utf8");

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
