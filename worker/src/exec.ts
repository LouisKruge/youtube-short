import { spawn } from "node:child_process";

export interface RunResult {
  stdout: string;
  stderr: string;
}

/**
 * Runs a binary with an argv array — never through a shell, so a hostile
 * source URL cannot inject shell metacharacters.
 */
export function run(
  command: string,
  args: string[],
  options: { timeoutMs?: number; cwd?: string } = {},
): Promise<RunResult> {
  const timeoutMs = options.timeoutMs ?? 30 * 60_000;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`${command} timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      // ffmpeg's progress output is unbounded on long inputs; keep the tail.
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000);
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(
        new Error(
          `Could not run ${command}. Is it installed on the worker image? (${err.message})`,
        ),
      );
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const tail = stderr.trim().split("\n").slice(-6).join("\n");
        reject(new Error(`${command} exited ${code}: ${tail}`));
      }
    });
  });
}

export const ffmpeg = (args: string[], timeoutMs?: number) =>
  run("ffmpeg", ["-hide_banner", "-nostdin", "-y", ...args], { timeoutMs });

export const ffprobe = (args: string[]) => run("ffprobe", ["-hide_banner", ...args]);

/**
 * Timeout for an ffmpeg pass that reads a whole source end to end.
 *
 * A fixed cap is the wrong shape for work whose cost scales with length. The
 * scene detector had 30 minutes: generous for a five-minute source, and not
 * enough for a two-hour one, so a long source failed on the clock rather than
 * on anything wrong with it — then burned two more attempts doing it again.
 *
 * Measured on a 1080p30 source, decoding single-threaded: a full pass runs at
 * roughly 6x realtime. Allowing 1x realtime is therefore a six-fold margin,
 * which leaves room for a throttled shared vCPU without ever letting a genuine
 * hang run forever. The floor covers short sources, where process startup and
 * the first seek dominate.
 */
export function scanTimeoutMs(durationSeconds: number | null | undefined): number {
  const floor = 20 * 60_000;
  if (!durationSeconds || !Number.isFinite(durationSeconds)) return floor;
  return Math.max(floor, Math.round(durationSeconds * 1000));
}

export const ytdlp = (args: string[], timeoutMs?: number) =>
  run("yt-dlp", args, { timeoutMs });
