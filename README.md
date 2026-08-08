# Nexus Clips

Ingest a source video by URL, find its high-energy moments from the audio, cut
them into ~30 second vertical clips, burn in captions, write description hooks
with Claude, and publish to YouTube inside the daily API quota.

---

## ⚠️ This is two services, not one

**The Vercel app alone is not a working product.** You must also deploy the
worker container in [`worker/`](./worker). This is an architectural
requirement, not a preference:

| | Vercel app | Worker service |
|---|---|---|
| **Runs** | Dashboard, queue, API routes, YouTube OAuth | yt-dlp, ffmpeg, Whisper, **and the YouTube upload** |
| **Why there** | Serverless functions suit request/response work | Video work needs real disk, real binaries, and minutes of runtime |
| **Deploy to** | Vercel (**Hobby is fine**) | Railway, Render, Fly.io, or any container host |

**There are no Vercel cron jobs.** The worker drives its own schedule from a
60-second poll loop. That is deliberate: Hobby restricts both how many cron
jobs you get and how often they may fire, and a serverless function's
execution ceiling is shorter than a 1080×1920 upload routinely takes. Putting
the schedule and the upload on the worker removes both limits and keeps the
rendered file on the machine that made it, instead of round-tripping it
through a function. The Vercel side is a pure dashboard.

A Vercel function has no ffmpeg or yt-dlp binary, no writable disk beyond
`/tmp`, and an execution ceiling (10s Hobby, 60s Pro, up to 900s with Fluid
Compute) far below the time a 40-minute source video needs to download and
encode. So the app never processes video. It writes rows to Postgres and pokes
the worker; the worker claims jobs from Postgres and writes results back.

If you skip the worker, every source video will sit at "Queued for download"
forever.

```
   Browser
      │
      ▼
┌──────────────┐   nudge (HTTP)   ┌──────────────────────────────┐
│  Vercel app  │ ───────────────▶ │  Worker (Railway/Render/Fly) │
│  dashboard   │                  │  yt-dlp · ffmpeg · Whisper   │
│  + OAuth     │                  │  + upload · self-polls 60s   │
└──────┬───────┘                  └────────┬──────────────┬──────┘
       │                                   │              │
       │                    claims jobs,   │              ▼
       └────────▶ Supabase ◀───────────────┘     YouTube Data API v3
              (Postgres + Storage)
```

The nudge is only for responsiveness — the worker self-polls every 60s, so a
lost nudge or a sleeping app delays work rather than stopping it.

---

## Pipeline

| # | Stage | Runs on | What happens |
|---|---|---|---|
| 1 | Ingest | Worker | `yt-dlp` pulls the URL, capped at 1080p, into Supabase Storage |
| 2 | Analyze | Worker | ffmpeg `astats` samples RMS loudness every 0.5s; `silencedetect` finds pauses; peaks above a rolling baseline become clip windows |
| 3+4 | Segment & crop | Worker | One ffmpeg pass cuts the window and scales-to-cover/centre-crops to 1080×1920 |
| 5 | Transcribe | Worker | Whisper with word-level timestamps |
| 7 | Hooks | Worker | Claude (`claude-opus-5`) writes 3–5 description hooks |
| 8 | Review gate | App | Clip appears as **Ready**; needs a caption style and a hook |
| 6 | Caption burn-in | Worker | Generates an ASS subtitle track and burns it in |
| 9 | Upload | Worker | Reserves quota, uploads via YouTube Data API v3, records the result |

Caption burn-in is numbered 6 but happens after review — see the tradeoff
below.

### How clips are chosen

A clip window is a span where loudness stands above its own rolling
neighbourhood, with the boundaries snapped outward to the nearest natural
pause so a cut does not land mid-word. Windows are taken greedily by score and
never overlap.

**This measures acoustic intensity and nothing else.** It is a proxy for
"something happens here". It is not a viewership signal, and the UI never
claims otherwise — the label is "high-energy moment". No public API exposes
retention or most-replayed data for third-party video, so audio-peak detection
is the honest substitute, and calling it anything else would be a lie to the
operator.

---

## Setup

### 1. Supabase

Create a project, then run the migration:

```bash
psql "$SUPABASE_DB_URL" -f supabase/migrations/0001_init.sql
# or: npx supabase db push
```

This creates the tables, owner-only RLS policies, the `reserve_quota` function,
and the private `nexus-media` storage bucket.

Under **Authentication → Providers**, make sure Email is enabled. Sign-in is a
magic link; the first account to sign in becomes the owner of its own rows.

If you change the schema, regenerate the types:

```bash
npx supabase gen types typescript --project-id <ref> > lib/supabase/database.types.ts
```

### 2. Google Cloud — YouTube Data API v3 (manual, and slow)

1. Create a project in the [Cloud Console](https://console.cloud.google.com).
2. **APIs & Services → Library** → enable **YouTube Data API v3**.
3. **OAuth consent screen** → External. Add scopes
   `youtube.upload` and `youtube.readonly`. While the app is in *Testing*, add
   your own Google account under **Test users** — without that, authorization
   fails.
4. **Credentials → Create credentials → OAuth client ID → Web application.**
   Add the redirect URI, matching exactly:
   - local: `http://localhost:3000/api/auth/youtube/callback`
   - production: `https://<your-app>/api/auth/youtube/callback`
5. Copy the client ID and secret into the env vars below.

> **Unverified apps expire tokens after 7 days.** Until Google verifies your
> OAuth consent screen, refresh tokens for apps in *Testing* stop working
> after a week and you must reconnect the channel. Publishing the consent
> screen requires Google's verification review.

### 3. Anthropic and Whisper

- `ANTHROPIC_API_KEY` from [console.anthropic.com](https://console.anthropic.com).
  Hooks use `claude-opus-5` with structured outputs at `effort: "low"` — short
  creative text does not need more, and it keeps per-clip cost down.
- `OPENAI_API_KEY` for hosted Whisper. To self-host `whisper.cpp` instead,
  replace `transcribeClip()` in `worker/src/pipeline/transcribe.ts`; nothing
  else depends on the provider.

Hook generation opts into server-side refusal fallbacks
(`server-side-fallback-2026-07-01`). If that beta is not enabled on your
account the code transparently retries on the standard endpoint, and a refusal
falls back to a transcript-derived line — a clip never reaches review without
a usable description.

### 4. Deploy the worker

See [`worker/README.md`](./worker/README.md). Short version: it is a
Dockerfile, it needs the Supabase service key plus the model API keys, and it
must share `WORKER_SHARED_SECRET` with the app.

### 5. Deploy the app to Vercel

Set the env vars from [`.env.example`](./.env.example), then deploy. Nothing
here exceeds Hobby limits: every route is a short request/response handler,
there are no cron jobs, and no function raises `maxDuration`.

Make sure **Project Settings → Git** has the repository connected and
**Production Branch** set to `main`. A project with no connected repo — or one
pointed at a branch that does not exist — shows *"No Production Deployment"*
and never builds.

[`vercel.json`](./vercel.json) pins `"framework": "nextjs"`, and it needs to
stay. A Vercel project created against an *empty* repository has nothing to
detect, so it falls back to the "Other" preset and looks for a static
`public/` directory after the build — producing:

```
Error: No Output Directory named "public" found after the Build completed.
```

The build itself succeeds; Vercel just doesn't know where to look. The
`framework` key overrides the Project Settings preset, so the fix travels with
the repo rather than living in a dashboard toggle. (If that error survives
this file, someone has *explicitly* set an Output Directory in **Project
Settings → Build & Deployment** — clear it back to auto-detect.)

The file deliberately contains no `crons` and no `functions.maxDuration` —
see the Hobby note at the top.

The worker's own schedule replaces what cron jobs would have done:

| Stage | Cadence | Does |
|---|---|---|
| Auto-approve | every worker pass | Picks default caption style and top hook (only when auto-upload is on) |
| Upload | every worker pass | Publishes one queued clip per pass, within remaining quota |

A pass runs on every self-poll (60s by default, `POLL_INTERVAL_MS`) and on
every nudge from the app.

---

## Quota — the binding constraint

YouTube Data API v3 grants **10,000 units per day** by default.
A `videos.insert` costs **1,600 units**.

**That is six uploads per day. Not a soft limit — a wall.**

- Usage is tracked per day in `quota_usage`.
- Reservation happens in a single SQL function (`reserve_quota`) that
  check-and-increments under a row lock, so two overlapping worker passes
  cannot both spend the last slot.
- When the ceiling is reached the remaining clips stay `queued` for the next
  day. Nothing is dropped.
- Quota resets at **midnight Pacific**, not UTC — this trips people up. Verify
  the reset time for your project in the Cloud Console.
- The dashboard shows remaining uploads as six discrete cells, and the review
  grid tells you which queued clips will actually go out on the next run.

### Raising the ceiling

Google grants increases through the **YouTube API Services — Audit and
Quota Extension** form in the Cloud Console. It is a **manual application**:
you describe your use case, they review it, and it takes weeks and is often
declined. **Nexus cannot request one for you.** Raising
`daily_quota_limit` in Settings only raises Nexus's own guard rail — set it
above what Google actually granted and uploads will start failing with
`quotaExceeded`.

Note that YouTube charges quota **on request, not on success**. A failed
upload still costs 1,600 units. Nexus only refunds its local counter for
failures that never reached the API (missing file, no channel connected).

---

## The caption rendering tradeoff

Two caption styles exist per clip: **karaoke** (word-by-word sweep) and
**static** (line-by-line). Burning captions in means re-encoding the video, so
rendering both for every clip doubles the CPU and storage.

**Default (`RENDER_BOTH_CAPTION_STYLES=false`) — render on selection.** One
encode per clip, and only for clips that get approved. Cost: the operator
waits ~20s after picking a style before the clip is queued.

**Alternative (`=true`) — pre-render both.** Selecting a style is instant
because both files already exist. Cost: roughly 2× CPU and storage on every
clip, and half of it is wasted on clips that are never approved.

Render-on-select is the default because most clips in a batch get rejected,
and paying to encode captions for a clip nobody publishes is the worse waste.
Flip it if your approval rate is high or your operator is impatient.

Either way the schema is the same: `caption_paths` maps style → storage path,
and `caption_burned_path` points at the file that will be uploaded.

---

## Security notes

- **RLS is on for every table**, owner-scoped via `auth.uid()`. The browser
  uses the anon key and can only see its own rows.
- Route handlers use the service-role key (which bypasses RLS) but gate on the
  session first and scope every query by `owner_id`.
- `youtube_accounts` holds a refresh token and has **no select policy** — the
  browser can never read it, even with a valid session.
- **API keys live in environment variables, never in the database.** The
  Settings page reports whether each credential is configured; it cannot show
  or set the values. That is deliberate: a settings table with plaintext keys
  is a database dump away from being a credential leak.
- The media bucket is private; previews use short-lived signed URLs.
- Subprocesses are spawned with an argv array, never a shell string, so a
  hostile source URL cannot inject shell metacharacters.

---

## Local development

```bash
cp .env.example .env.local     # fill in
npm install
npm run dev

# separate terminal
cd worker
cp .env.example .env           # fill in
npm install
npm run dev                    # needs ffmpeg + yt-dlp on PATH
```

For local worker development install the binaries:
`brew install ffmpeg yt-dlp` or `apt install ffmpeg && pipx install yt-dlp`.

Type checks: `npm run typecheck` in each of the two directories.

---

## Explicit non-goals

- **No "most watched moment" detection.** No public API provides retention or
  replay data for third-party video. Audio-peak detection is the honest
  substitute and is labelled as such throughout the UI.
- **No rights laundering.** The download step exists to move a video *you have
  the rights to* into the pipeline. Nexus does not check licensing, does not
  bypass any platform's access controls, and takes no position on what you
  feed it. Sourcing and rights are entirely your call and your liability.

---

## Known gaps

- The 9:16 crop is a centre crop. It has no idea where the subject is, so a
  two-shot or an off-centre speaker will be cropped badly. Subject-aware
  reframing would need face/saliency tracking.
- Retry is per-stage with a fixed attempt cap; there is no backoff schedule.
- The worker processes one job per stage per pass. It is not horizontally
  scaled — the compare-and-swap claim is safe for multiple workers, but
  throughput is one clip at a time per instance.
