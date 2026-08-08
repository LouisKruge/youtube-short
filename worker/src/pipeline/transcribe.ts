import { join } from "node:path";
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
 * Whisper with word-level timestamps.
 *
 * Audio is extracted to 16 kHz mono MP3 first: Whisper downsamples to 16 kHz
 * internally anyway, and the API rejects files over 25 MB — a 30-second clip
 * lands around 300 KB this way.
 *
 * Swapping in a self-hosted whisper.cpp means replacing this one function;
 * nothing else in the pipeline depends on the provider.
 */
export async function transcribeClip(
  videoPath: string,
  workDir: string,
): Promise<Transcript> {
  const audioPath = join(workDir, "audio.mp3");

  await ffmpeg(
    [
      "-i",
      videoPath,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-b:a",
      "64k",
      audioPath,
    ],
    5 * 60_000,
  );

  const response = await openai().audio.transcriptions.create({
    file: readStream(audioPath),
    model: "whisper-1",
    response_format: "verbose_json",
    timestamp_granularities: ["word"],
  });

  const raw = response as unknown as {
    text?: string;
    words?: Array<{ word: string; start: number; end: number }>;
  };

  const words: TranscriptWord[] = (raw.words ?? [])
    .filter((w) => typeof w.word === "string" && Number.isFinite(w.start))
    .map((w) => ({
      word: w.word.trim(),
      // Times are relative to the clip, which is what the caption renderer
      // wants — no offsetting against the source needed.
      start: Number(w.start.toFixed(3)),
      end: Number(w.end.toFixed(3)),
    }))
    .filter((w) => w.word.length > 0);

  return { text: (raw.text ?? "").trim(), words };
}
