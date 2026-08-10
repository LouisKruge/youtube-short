import { join } from "node:path";
import { rm } from "node:fs/promises";
import OpenAI from "openai";
import { config } from "../config.js";
import { ffmpeg } from "../exec.js";
import { readStream } from "../storage.js";

export interface TranscriptWord {
  word: string;
  start: number;
  end: number;
}

export interface Transcript {
  text: string;
  words: TranscriptWord[];
}

let client: OpenAI | null = null;

function openai(): OpenAI {
  if (!config.openaiApiKey) {
    throw new Error(
      "OPENAI_API_KEY is not set on the worker. Captions need word-level timestamps from Whisper.",
    );
  }
  if (!client) client = new OpenAI({ apiKey: config.openaiApiKey });
  return client;
}

/**
 * 16 kHz mono MP3 at 64 kbps. Whisper downsamples to 16 kHz internally, so
 * anything higher is upload time for no accuracy.
 */
async function extractAudio(
  videoPath: string,
  audioPath: string,
  range?: { start: number; duration: number },
): Promise<void> {
  await ffmpeg(
    [
      ...(range ? ["-accurate_seek", "-ss", String(range.start)] : []),
      "-i",
      videoPath,
      ...(range ? ["-t", String(range.duration)] : []),
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-b:a",
      "64k",
      audioPath,
    ],
    15 * 60_000,
  );
}

/**
 * Turns an OpenAI SDK failure into something that names the actual problem.
 *
 * The SDK reports every transport failure as `APIConnectionError: Connection
 * error.` and puts the real one on `.cause` — the same shape as Node's
 * `TypeError: fetch failed`, and just as useless on its own. Three attempts of
 * a forty-minute job were spent recording that sentence and nothing else.
 *
 * DNS failure, refused connection, TLS rejection, a reset mid-upload and an
 * expired key all arrive as that one string, and they have completely
 * different fixes.
 */
function describeOpenAIError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);

  const parts: string[] = [err.message];

  const status = (err as { status?: number }).status;
  if (typeof status === "number") parts.push(`HTTP ${status}`);

  const code = (err as { code?: string }).code;
  if (code) parts.push(String(code));

  // Walk the cause chain: APIConnectionError -> fetch TypeError -> the syscall
  // error that actually says what went wrong.
  let cause: unknown = (err as { cause?: unknown }).cause;
  for (let depth = 0; cause instanceof Error && depth < 4; depth++) {
    const causeCode = (cause as { code?: string }).code;
    parts.push(causeCode ? `${cause.message} (${causeCode})` : cause.message);
    cause = (cause as { cause?: unknown }).cause;
  }

  const text = parts.filter(Boolean).join(" · ");

  // Translate the codes that have a specific, actionable meaning here.
  if (/ENOTFOUND|EAI_AGAIN/.test(text)) {
    return `${text} — the worker could not resolve api.openai.com. This is DNS on the worker's host, not the key.`;
  }
  if (/ECONNREFUSED|ECONNRESET|EPIPE|ETIMEDOUT|UND_ERR/.test(text)) {
    return `${text} — the connection to OpenAI dropped mid-request. Usually the host's outbound network rather than the request itself.`;
  }
  if (status === 401) {
    return `${text} — OPENAI_API_KEY is not valid. Check it at platform.openai.com/api-keys.`;
  }
  if (status === 429) {
    return `${text} — rate limited, or the account has no remaining credit. Check usage and billing at platform.openai.com.`;
  }

  return text;
}

async function transcribeAudioFile(path: string): Promise<Transcript> {
  let response;
  try {
    response = await openai().audio.transcriptions.create({
      file: readStream(path),
      model: "whisper-1",
      response_format: "verbose_json",
      timestamp_granularities: ["word"],
    });
  } catch (err) {
    throw new Error(`Whisper request failed: ${describeOpenAIError(err)}`);
  }

  const raw = response as unknown as {
    text?: string;
    words?: Array<{ word: string; start: number; end: number }>;
  };

  const words: TranscriptWord[] = (raw.words ?? [])
    .filter((w) => typeof w.word === "string" && Number.isFinite(w.start))
    .map((w) => ({
      word: w.word.trim(),
      start: Number(w.start.toFixed(3)),
      end: Number(w.end.toFixed(3)),
    }))
    .filter((w) => w.word.length > 0);

  return { text: (raw.text ?? "").trim(), words };
}

/**
 * Transcribes one already-cut clip. Timestamps come back relative to the
 * clip, which is exactly what the caption renderer wants.
 *
 * Swapping in a self-hosted whisper.cpp means replacing transcribeAudioFile;
 * nothing else in the pipeline depends on the provider.
 */
export async function transcribeClip(
  videoPath: string,
  workDir: string,
): Promise<Transcript> {
  const audioPath = join(workDir, "audio.mp3");
  await extractAudio(videoPath, audioPath);
  return transcribeAudioFile(audioPath);
}

/** 10 minutes of 64 kbps mono is ~4.8 MB, comfortably under the 25 MB cap. */
const CHUNK_SECONDS = 600;

/**
 * Transcribes a full source video of any length.
 *
 * Whisper rejects uploads over 25 MB, which a 2-hour stream exceeds even at
 * 64 kbps mono — so the audio is cut into chunks and each chunk's word
 * timestamps are shifted back onto the source timeline. Without the offset
 * every chunk would claim to start at zero and the moment scorer would place
 * everything in the first ten minutes.
 *
 * Chunks are transcribed sequentially on purpose: a long source would
 * otherwise fire a dozen concurrent uploads and hit the API's rate limit.
 */
export async function transcribeSource(
  videoPath: string,
  workDir: string,
  durationSeconds: number,
  onProgress?: (fraction: number) => void,
): Promise<Transcript> {
  // Cheapest possible request first. Reaching this point costs several minutes
  // of envelope and scene detection, and a key or a network that is not going
  // to work does not become workable after eleven audio uploads — it just
  // wastes the whole analysis three times over before saying so.
  try {
    await openai().models.list();
  } catch (err) {
    throw new Error(`Cannot reach OpenAI: ${describeOpenAIError(err)}`);
  }

  const chunkCount = Math.max(1, Math.ceil(durationSeconds / CHUNK_SECONDS));

  const words: TranscriptWord[] = [];
  const texts: string[] = [];

  for (let i = 0; i < chunkCount; i++) {
    const start = i * CHUNK_SECONDS;
    const duration = Math.min(CHUNK_SECONDS, durationSeconds - start);
    if (duration <= 0.5) break;

    const chunkPath = join(workDir, `chunk-${i}.mp3`);
    await extractAudio(videoPath, chunkPath, { start, duration });

    const chunk = await transcribeAudioFile(chunkPath);

    for (const word of chunk.words) {
      words.push({
        word: word.word,
        start: Number((word.start + start).toFixed(3)),
        end: Number((word.end + start).toFixed(3)),
      });
    }
    if (chunk.text) texts.push(chunk.text);

    await rm(chunkPath, { force: true });
    onProgress?.((i + 1) / chunkCount);
  }

  return { text: texts.join(" ").trim(), words };
}

/** The words falling inside a window, re-based to that window's start. */
export function wordsInWindow(
  transcript: Transcript,
  start: number,
  end: number,
): TranscriptWord[] {
  return transcript.words
    .filter((w) => w.end > start && w.start < end)
    .map((w) => ({
      word: w.word,
      start: Number(Math.max(0, w.start - start).toFixed(3)),
      end: Number(Math.max(0, w.end - start).toFixed(3)),
    }));
}

/** Plain text of a window, for prompting. */
export function textInWindow(
  transcript: Transcript,
  start: number,
  end: number,
): string {
  return transcript.words
    .filter((w) => w.end > start && w.start < end)
    .map((w) => w.word)
    .join(" ")
    .trim();
}
