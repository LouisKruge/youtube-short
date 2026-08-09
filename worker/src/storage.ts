import { createReadStream } from "node:fs";
import { copyFile, readFile, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
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

/**
 * Marks a path as living on this worker's disk rather than in Supabase Storage.
 *
 * Source videos do not go to Storage. A two-hour 1080p file is about 4 GB, which
 * is 86x Supabase's free-tier per-file cap and four times the whole plan's
 * allowance — and paying to warehouse it would be paying twice, because the
 * worker already has a volume and is the only thing that ever reads it. Finished
 * clips are a few megabytes and do go to Storage, because the browser has to
 * fetch those.
 *
 * The cost of this is that a source is tied to the machine that fetched it. If
 * the volume is lost the source has to be fetched again — which is the right
 * trade for a file that is pure input.
 */
export const LOCAL_PREFIX = "local:";

export function isLocalPath(storagePath: string): boolean {
  return storagePath.startsWith(LOCAL_PREFIX);
}

/** Absolute path on the volume for a `local:` reference. */
export function localPathFor(storagePath: string): string {
  return join(config.mediaDir, storagePath.slice(LOCAL_PREFIX.length));
}

/** Keeps a file on the volume and returns the reference to store in the row. */
export async function keepLocally(
  localPath: string,
  relativePath: string,
): Promise<string> {
  const destination = join(config.mediaDir, relativePath);
  await mkdir(dirname(destination), { recursive: true });
  if (localPath !== destination) await copyFile(localPath, destination);
  return `${LOCAL_PREFIX}${relativePath}`;
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
  // A local reference is already on this machine; hand back the real path
  // rather than copying several gigabytes to sit beside itself.
  if (isLocalPath(storagePath)) {
    const source = localPathFor(storagePath);
    try {
      await stat(source);
    } catch {
      throw new Error(
        `The source file is no longer on this worker (${storagePath}). It was ` +
          `kept on the volume rather than in Storage; if the machine was ` +
          `replaced, re-add the source.`,
      );
    }
    return source;
  }

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
