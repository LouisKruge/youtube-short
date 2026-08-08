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

Upload is deliberately *not* here — it lives in the app's cron so quota
accounting stays in one place.

## Job claiming

Claiming is a compare-and-swap: read a candidate, then update conditioned on
the status that was read. Two workers racing for the same row produce exactly
one winner, because the loser's update matches zero rows. A claim older than
`CLAIM_TIMEOUT_MS` is treated as a crashed worker and reclaimed.

A job that throws is returned to the queue with its attempt count incremented.
After `MAX_ATTEMPTS` it is parked as `failed` with the error message, which
surfaces in the dashboard.

## Deploying

### Railway / Render

Point at this directory, let it use the `Dockerfile`, and set the environment
variables from `.env.example`. Health check path is `/health`.

### Fly.io

```bash
cd worker
fly launch --dockerfile Dockerfile
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
