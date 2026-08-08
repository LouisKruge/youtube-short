import { createReadStream } from "node:fs";
import { readFile, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { db } from "./db.js";

export async function ensureMediaDir(): Promise<string> {
  await mkdir(config.mediaDir, { recursive: true });
  return config.mediaDir;
}

/** A throwaway directory for one job, removed in a finally block. */
export async function scratchDir(prefix: string): Promise<string> {
  const dir = join(config.mediaDir, `${prefix}-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function cleanup(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true }).catch(() => {});
}

export async function uploadFile(
  localPath: string,
  storagePath: string,
  contentType: string,
): Promise<string> {
  const body = await readFile(localPath);

  const { error } = await db.storage
    .from(config.mediaBucket)
    .upload(storagePath, body, { contentType, upsert: true });

  if (error) throw new Error(`Upload to storage failed: ${error.message}`);
  return storagePath;
}

export async function downloadFile(
  storagePath: string,
  localPath: string,
): Promise<string> {
  const { data, error } = await db.storage
    .from(config.mediaBucket)
    .download(storagePath);

  if (error || !data) {
    throw new Error(`Could not read ${storagePath} from storage: ${error?.message}`);
  }

  await writeFile(localPath, Buffer.from(await data.arrayBuffer()));
  return localPath;
}

export function readStream(path: string) {
  return createReadStream(path);
}
