#!/usr/bin/env bash
#
# One-shot Fly deploy for the Nexus Clips worker.
#
# Run it from inside the `worker` directory:
#
#   ./deploy-fly.sh
#
# It reads the app name and region from fly.toml, so there is nothing to keep in
# sync by hand. It stops at the first failure rather than carrying on and
# leaving a half-built app, and every step says what it is doing and why.
#
# It will ask for the four secrets it cannot know. Nothing is written to disk.

set -euo pipefail

step() { printf '\n\033[1m── %s\033[0m\n' "$1"; }
fail() { printf '\n\033[1mSTOPPED:\033[0m %s\n' "$1" >&2; exit 1; }

# --- Preflight ---------------------------------------------------------------

step "Checking prerequisites"

command -v fly >/dev/null 2>&1 || fail \
  "flyctl is not installed. Install it, then run this again:
     macOS/Linux:  curl -L https://fly.io/install.sh | sh
     Windows:      iwr https://fly.io/install.ps1 -useb | iex
   You may need to restart your terminal afterwards."

[ -f fly.toml ] || fail \
  "No fly.toml here. You are in $(pwd).
   Run this from the 'worker' directory of the repository:
     cd /path/to/youtube-short/worker && ./deploy-fly.sh"

fly auth whoami >/dev/null 2>&1 || fail \
  "Not signed in to Fly. Run:  fly auth login"

APP=$(grep -E '^app = ' fly.toml | head -1 | sed 's/.*= *"\(.*\)"/\1/')
REGION=$(grep -E '^primary_region = ' fly.toml | head -1 | sed 's/.*= *"\(.*\)"/\1/')
VOLUME=$(grep -A3 '^\[mounts\]' fly.toml | grep 'source' | head -1 | sed 's/.*= *"\(.*\)"/\1/')

[ -n "$APP" ] || fail "Could not read the app name out of fly.toml."

echo "  app:    $APP"
echo "  region: $REGION"
echo "  volume: $VOLUME"
echo "  URL:    https://$APP.fly.dev"

# --- Create the app ----------------------------------------------------------

step "Creating the app (skipped if it already exists)"

if fly status --app "$APP" >/dev/null 2>&1; then
  echo "  Already exists — leaving it alone."
else
  # --no-deploy because the volume and the secrets have to exist first; a deploy
  # without them fails in ways that do not point back at the cause.
  fly launch --no-deploy --copy-config --name "$APP" --region "$REGION" --yes \
    || fail "Could not create the app. If the name is taken, change 'app =' in fly.toml and run this again."
fi

# --- Volume ------------------------------------------------------------------

step "Creating the volume (skipped if it already exists)"

# fly.toml declares [mounts], and a deploy fails outright if the volume named
# there does not already exist in the app's region.
if fly volumes list --app "$APP" 2>/dev/null | grep -q "$VOLUME"; then
  echo "  Already exists — leaving it alone."
else
  fly volumes create "$VOLUME" --app "$APP" --region "$REGION" --size 20 --yes \
    || fail "Could not create the volume."
fi

# --- Secrets -----------------------------------------------------------------

step "Setting secrets"

echo "  Paste each value. Input is hidden. Press Enter after each."
echo

read -rsp "  SUPABASE_SERVICE_ROLE_KEY (Supabase → Settings → API → service_role): " SERVICE_KEY; echo
read -rsp "  OPENAI_API_KEY (Whisper transcription): " OPENAI_KEY; echo
echo
echo "  ANTHROPIC_API_KEY — optional. Press Enter to skip."
echo "  Without it the pipeline still runs: moments are ranked on audio energy"
echo "  instead of on craft, and hooks and titles come from the transcript."
echo "  Add it later with:  fly secrets set ANTHROPIC_API_KEY=... --app $APP"
read -rsp "  > " ANTHROPIC_KEY; echo
read -rp  "  SUPABASE_URL [https://pxglkushjutzbmlbbrbe.supabase.co]: " SUPABASE_URL
SUPABASE_URL=${SUPABASE_URL:-https://pxglkushjutzbmlbbrbe.supabase.co}
read -rp  "  WORKER_SHARED_SECRET (must match Vercel): " SHARED_SECRET

[ -n "$SERVICE_KEY" ] || fail "SUPABASE_SERVICE_ROLE_KEY is required — the worker cannot claim jobs without it."
[ -n "$SHARED_SECRET" ] || fail "WORKER_SHARED_SECRET is required."

# Only send keys that were actually given. Setting an empty secret is not the
# same as leaving it unset — the code checks for a non-empty string to decide
# whether the feature is available.
SECRET_ARGS=(
  "WORKER_SHARED_SECRET=$SHARED_SECRET"
  "SUPABASE_URL=$SUPABASE_URL"
  "SUPABASE_SERVICE_ROLE_KEY=$SERVICE_KEY"
)
[ -n "$OPENAI_KEY" ]    && SECRET_ARGS+=("OPENAI_API_KEY=$OPENAI_KEY")
[ -n "$ANTHROPIC_KEY" ] && SECRET_ARGS+=("ANTHROPIC_API_KEY=$ANTHROPIC_KEY")

fly secrets set --app "$APP" --stage "${SECRET_ARGS[@]}" \
  || fail "Could not set secrets."

[ -n "$ANTHROPIC_KEY" ] || echo "  (no Anthropic key — audio-only ranking, transcript-derived hooks)"

# --- Deploy ------------------------------------------------------------------

step "Building and deploying (this is the slow part — several minutes)"

fly deploy --app "$APP" || fail \
  "The deploy failed. The build log above says why.
   Copy the last 30 lines or so — that is what is needed to fix it."

# --- Verify ------------------------------------------------------------------

step "Verifying"

URL="https://$APP.fly.dev"
echo "  Waiting for the machine to answer…"

for attempt in $(seq 1 20); do
  BODY=$(curl -fsS -m 10 "$URL/health" 2>/dev/null || true)
  if printf '%s' "$BODY" | grep -q 'nexus-clips-worker'; then
    printf '\n  \033[1mThe worker is up.\033[0m\n'
    echo "  $BODY"
    printf '\n══════════════════════════════════════════════════════════════\n'
    printf '  Now add these in Vercel → Settings → Environment Variables,\n'
    printf '  then REDEPLOY (new variables do not reach a running deploy):\n\n'
    printf '    WORKER_URL=%s\n' "$URL"
    printf '    WORKER_SHARED_SECRET=%s\n' "$SHARED_SECRET"
    printf '    SUPABASE_SERVICE_ROLE_KEY=(the same one you just pasted)\n'
    printf '══════════════════════════════════════════════════════════════\n\n'
    exit 0
  fi
  sleep 6
done

fail "Deployed, but $URL/health never answered.
   Check the logs:  fly logs --app $APP
   A crash on boot is usually a missing or wrong secret."
