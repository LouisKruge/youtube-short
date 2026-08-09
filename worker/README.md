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

## Running it locally (no host, no card)

Scripted:

```bash
cd youtube-short/worker
./run-local.sh
```

It checks Node, ffmpeg and yt-dlp are present (and prints the install command
for whichever is missing), asks once for the credentials and saves them to a
gitignored `worker/.env`, builds, and starts. Leave the window open.

Or by hand:

Jobs are claimed by **polling**, not pushed — the HTTP nudge from the app only
saves up to one poll interval of latency. So the worker does not need to be
publicly reachable, and running it on your own machine is a supported
deployment, not a workaround:

```bash
cd worker
npm install
npm run build

WORKER_SHARED_SECRET=anything \
SUPABASE_URL=https://<project>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service role key> \
OPENAI_API_KEY=<...> \
ANTHROPIC_API_KEY=<...> \
npm start
```

You need `ffmpeg` and `yt-dlp` on your PATH — that is the only thing the
container was providing.

Leave `WORKER_URL` unset in Vercel. The worker writes a heartbeat to Supabase on
every pass, and the dashboard reads that instead: the sidebar shows
`worker · polling` and Settings explains it is running without an inbound URL.
Queued work drains within one poll interval (60s by default).

The trade-offs are real and worth stating: work only happens while your machine
is awake, and a two-hour source will occupy a core for a while. But it costs
nothing, and it is the fastest way to find out whether the pipeline does what
you want before paying anyone to host it.

## Deploying

### Render — browser only, no terminal

The blueprint is `render.yaml` **at the repository root** — Render only reads it
from there, which is why it does not sit in this directory.

Dashboard → **New → Blueprint** → pick this repository → **Apply**. Render reads
the file, builds the Dockerfile itself, and prompts in the web UI for each value
marked `sync: false`. No CLI, no local checkout.

The address is fixed by the service name in that file:
`https://nexus-clips-worker-30af5d.onrender.com`

### Railway

Point at this directory, let it use the `Dockerfile`, and set the environment
variables from `.env.example`. Health check path is `/health`.

### Fly.io — scripted

Mac or Linux:

```bash
cd worker
./deploy-fly.sh
```

Windows PowerShell:

```powershell
cd worker
.\deploy-fly.ps1
```

The two do the same thing. The PowerShell one targets Windows PowerShell 5.1 —
the version that ships with Windows — so it avoids syntax only PowerShell 7
understands.

Creates the app, creates the volume the `[mounts]` block requires, prompts for
the secrets, deploys, waits for `/health` to answer, and prints the exact
variables to paste into Vercel. It stops at the first failure rather than
leaving a half-built app, and skips anything that already exists, so it is safe
to run again after fixing something.

The app name lives in `fly.toml`, which means the hostname is known before you
deploy rather than discovered afterwards.

### Fly.io — by hand

```bash
cd worker
fly launch --no-deploy --copy-config   # uses the committed fly.toml
fly volumes create nexus_media --size 20 --region lhr   # required by [mounts]
fly secrets set WORKER_SHARED_SECRET=... SUPABASE_URL=... \
  SUPABASE_SERVICE_ROLE_KEY=... OPENAI_API_KEY=... ANTHROPIC_API_KEY=...
fly deploy
```

### Running without an Anthropic key

`ANTHROPIC_API_KEY` is optional. Without it the pipeline runs end to end and
degrades in two specific places:

| With the key | Without |
|---|---|
| Candidates ranked on hook, payoff, pacing, curiosity | Ranked on audio energy alone |
| Clip score, factor breakdown, written assessment | No score — the UI says "not scored" |
| Hooks and titles written for the clip | First substantial sentence of the transcript |
| Stronger-opening suggestions | Not offered |

Everything else is unaffected: download, envelope, scene detection,
transcription, moment windows, the 9:16 crop, dead-time removal, captions,
cover frames and upload all work exactly the same.

Add the key later and it takes effect on the next source — already-cut clips
keep the metadata they were given.

## Where the media lives

Source videos stay on the worker's volume. Finished clips go to Supabase
Storage.

That split is not an optimisation, it is what makes the thing run at all on a
free Supabase plan. A two-hour 1080p source is about 4 GB — measured, roughly
39 MB per minute. Supabase Free caps a single file at 50 MB and the whole
project at 1 GB, so routing the source through Storage put it 86x over the
per-file limit. Paying to warehouse it would also be paying twice: the worker
already has a volume, and nothing except the worker ever reads a source.

Clips are the opposite case — a few megabytes each, and the browser has to fetch
them to show a preview — so those do go to Storage.

A source is therefore tied to the machine that fetched it. If the volume is
lost, the source has to be re-added; the pipeline says so plainly rather than
failing with a storage error. That is the right trade for a file that is pure
input.

## Sizing

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


## Finding WORKER_URL

The app does not know its own address; the host assigns one. Read it back
rather than assuming it matches any name in this repo:

| Host | Where to read it |
|---|---|
| Fly | `fly apps list` or `fly status` — the hostname is `<app>.fly.dev` |
| Render | The service page header, `<name>.onrender.com` |
| Railway | Settings → Networking → the generated domain |

Fly and Render both append or substitute when a name is taken, so the name you
asked for and the name you got are often different.

Confirm before pasting it into Vercel:

```bash
curl -i https://<host>/health
# {"ok":true,"draining":false,"service":"nexus-clips-worker"}
```

The dashboard's own reading distinguishes the failures for you:

- **does not resolve** — no app exists at that name. Check `fly apps list`.
  A stopped app still resolves; this means the name is wrong or nothing was
  ever created.
- **refused the connection** — the host exists but nothing is listening. The
  container is not running: check the host's logs for a failed build or a crash.
- **answered 404 / not the Nexus worker** — something else is at that address.
- **did not answer within 10s** — likely a cold start; check again shortly.

## YouTube and the bot check

`Sign in to confirm you're not a bot` is the most likely first failure on any
hosted worker. It is not about the video or about a stale yt-dlp — it is the IP.
Every cloud provider is on datacenter ranges and YouTube challenges those; the
same URL usually downloads fine from a home connection.

Three ways past it, cheapest first:

1. **Upload the file instead of the link.** Ingest takes a local file straight
   into Storage, and yt-dlp is never involved. Nothing to configure and nothing
   to maintain.

2. **Run the worker on your own machine** (see above). A residential IP is not
   challenged in the same way.

3. **Supply cookies.** Two steps, and the first one is easy to skip:

   **a.** Export the file. Install a "Get cookies.txt" extension in a browser
   that is signed in to YouTube, visit youtube.com, export, and save the file
   into this `worker` directory. There is no command for this part — the file
   has to come out of a browser.

   **b.** Put its contents in the secret:

   ```bash
   fly secrets set YTDLP_COOKIES="$(cat cookies.txt)" --app <your-app>       # mac/linux
   fly secrets set YTDLP_COOKIES="$(Get-Content cookies.txt -Raw)" --app <your-app>   # powershell
   ```

   If the file is not there, the shell substitutes nothing and the secret is set
   to an empty string. That is harmless — the worker treats empty as "no
   cookies" — but it looks like it worked when it did not.

   The worker writes it into the per-job scratch directory, hands it to yt-dlp,
   and deletes it with the rest of the job.

   Be aware of what this costs: those cookies are a live session for whatever
   Google account exported them, they expire and need replacing, and Google may
   treat a datacenter IP using them as suspicious — with the account, not just
   the download, as what gets restricted. A throwaway account is the sane
   choice if you go this way at all.

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

## Running without an Anthropic key

`ANTHROPIC_API_KEY` is optional. Without it the pipeline runs end to end and
degrades in two specific places:

| With the key | Without |
|---|---|
| Candidates ranked on hook, payoff, pacing, curiosity | Ranked on audio energy alone |
| Clip score, factor breakdown, written assessment | No score — the UI says "not scored" |
| Hooks and titles written for the clip | First substantial sentence of the transcript |
| Stronger-opening suggestions | Not offered |

Everything else is unaffected: download, envelope, scene detection,
transcription, moment windows, the 9:16 crop, dead-time removal, captions,
cover frames and upload all work exactly the same.

Add the key later and it takes effect on the next source — already-cut clips
keep the metadata they were given.

## Where the media lives

Source videos stay on the worker's volume. Finished clips go to Supabase
Storage.

That split is not an optimisation, it is what makes the thing run at all on a
free Supabase plan. A two-hour 1080p source is about 4 GB — measured, roughly
39 MB per minute. Supabase Free caps a single file at 50 MB and the whole
project at 1 GB, so routing the source through Storage put it 86x over the
per-file limit. Paying to warehouse it would also be paying twice: the worker
already has a volume, and nothing except the worker ever reads a source.

Clips are the opposite case — a few megabytes each, and the browser has to fetch
them to show a preview — so those do go to Storage.

A source is therefore tied to the machine that fetched it. If the volume is
lost, the source has to be re-added; the pipeline says so plainly rather than
failing with a storage error. That is the right trade for a file that is pure
input.

## Sizing

Peak resident memory of each ffmpeg stage, measured against a real 1080p source:

| Stage | Peak |
|---|---|
| Loudness envelope (decodes the whole file) | 57 MB |
| Scene detection | 113 MB |
| Cut a 30s clip | 375 MB |
| Crop to 1080x1920 vertical | 442 MB |

So the ceiling is ~442 MB, plus roughly 100 MB for the Node process. **2 GB is
ample; 1 GB would very likely do.** Anything advertising 4 GB as a requirement
for this workload — including earlier versions of these files — was guessing.

Memory does not grow with source length: ffmpeg streams, so a two-hour file
costs the same RAM as a five-minute one. Only the frame size matters. Length
drives **disk**, which is what the volume is for — a 1080p source runs roughly
40 MB per minute, so a two-hour episode is around 5 GB before any clips are cut.

CPU is the real constraint. That vertical crop encoded a 30-second clip in about
19 seconds of wall time at 141% CPU, so ten clips is a few minutes of sustained
load. Shared CPU handles that in bursts; sustained batching wants a dedicated
core.

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
