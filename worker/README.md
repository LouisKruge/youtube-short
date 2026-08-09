# Nexus Clips — worker

The half of Nexus Clips that touches video. Runs `yt-dlp`, `ffmpeg`, and
Whisper; claims jobs straight from Supabase and writes results back.

**This service is required.** Without it the Vercel app can create source rows
and nothing else — see the architecture section in the [root
README](../README.md).

## What it does

Each pass claims at most one job per stage, so a long download cannot starve
the caption renderer:

| Claims | Stage | Leaves it as |
|---|---|---|
| `source.pending_download` | yt-dlp download → Storage | `downloaded` |
| `source.downloaded` | loudness envelope + silence detection + peak picking, creates clip rows | `analyzed` |
| `clip.pending_segment` | cut + scale/crop to 1080×1920 in one ffmpeg pass | `transcribing` |
| `clip.transcribing` | Whisper word timestamps, then Claude hooks | `ready_for_review` |
| `clip.rendering` | burn the selected caption style in | `queued` |
| `clip.ready_for_review` | auto-approve: default style + top hook (only when auto-upload is on) | `rendering` |
| `clip.queued` | reserve quota, upload to YouTube, record the result | `uploaded` |

The last two are what Vercel cron jobs would otherwise have done. They live
here because a serverless function's execution ceiling is shorter than a
1080×1920 upload routinely takes, because Hobby restricts cron frequency, and
because the rendered file is already on this machine — uploading from Vercel
meant pulling it back out of Storage first.

Upload claims a clip by transitioning `queued → uploading` in the same
statement that selects it. The status change *is* the lock: a second worker's
update matches zero rows, so a clip can never be published twice.

## Job claiming

Claiming is a compare-and-swap: read a candidate, then update conditioned on
the status that was read. Two workers racing for the same row produce exactly
one winner, because the loser's update matches zero rows. A claim older than
`CLAIM_TIMEOUT_MS` is treated as a crashed worker and reclaimed.

A job that throws is returned to the queue with its attempt count incremented.
After `MAX_ATTEMPTS` it is parked as `failed` with the error message, which
surfaces in the dashboard.

## Deploying

### Render (no local tooling needed)

`render.yaml` is a blueprint. In the dashboard: **New → Blueprint**, point it at
this repository, set the root directory to `worker`. Render builds the
Dockerfile itself and prompts for each secret — nothing is stored in the repo.

### Railway

Point at this directory, let it use the `Dockerfile`, and set the environment
variables from `.env.example`. Health check path is `/health`.

### Fly.io

```bash
cd worker
fly launch --no-deploy --copy-config   # uses the committed fly.toml
fly secrets set WORKER_SHARED_SECRET=... SUPABASE_URL=... \
  SUPABASE_SERVICE_ROLE_KEY=... OPENAI_API_KEY=... ANTHROPIC_API_KEY=...
fly deploy
```

### Sizing

- **Disk:** needs room for the largest source video plus a working copy.
  `MEDIA_DIR` defaults to `/tmp/nexus-media`; scratch directories are removed
  in a `finally` block after every job, but a crash mid-encode can leave one
  behind. Give it a few GB.
- **CPU:** x264 encoding is the bottleneck. More cores means faster renders;
  one clip is processed at a time per instance.
- **Memory:** ~1 GB is comfortable. Files stream to disk rather than being
  held in memory.

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/health` | none | Liveness; the Settings page uses this |
| `POST` | `/jobs/run` | `Bearer $WORKER_SHARED_SECRET` | Nudge — acknowledges immediately, drains in the background |

The nudge returns straight away because the caller is a Vercel function that
must not block for the minutes an ffmpeg pass can take. Only one drain runs at
a time; extra nudges while one is in flight are a no-op.

## Swapping Whisper for something self-hosted

Replace `transcribeClip()` in `src/pipeline/transcribe.ts`. It takes a video
path and a scratch directory and returns `{ text, words }` with word-level
timings relative to the clip. Nothing else in the pipeline knows or cares
where that came from.

## Local development

Requires `ffmpeg` and `yt-dlp` on `PATH`:

```bash
brew install ffmpeg yt-dlp          # macOS
apt install ffmpeg && pipx install yt-dlp   # Debian/Ubuntu

cp .env.example .env
npm install
npm run dev
```


## Keeping downloads working

`yt-dlp` tracks YouTube's player, which changes often enough that yt-dlp ships a
release every few weeks. The image installs the **latest** release at build time
rather than a fixed version, because a pin is reproducible right up until
extraction breaks and then it is simply broken.

If downloads start failing with `Failed to extract any player response`, that is
what a stale binary looks like — **rebuild the image**. Nothing else needs to
change. To pin a known-good release instead:

```bash
docker build --build-arg YTDLP_VERSION=2026.07.01 -t nexus-worker .
```

## What has been exercised

The ffmpeg side of this worker has been run end to end against a synthetic
source: loudness envelope, silence detection, scene detection, motion crop
tracking, dead-time removal, the two-pass segment encode, ASS burn-in across all
four presets in both timings, and cover-frame extraction. The generated filter
strings — the piecewise crop expression and the select/aselect predicates, which
are the parts with awkward escaping — produce correct output.

Not yet exercised against a real job: `yt-dlp` downloading (needs network access
to the source), Whisper transcription, the Claude scoring call, and the YouTube
upload. Those need credentials rather than a video.
