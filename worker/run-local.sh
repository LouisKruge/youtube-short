#!/usr/bin/env bash
#
# Runs the Nexus Clips worker on your own machine.
#
#   cd youtube-short/worker
#   ./run-local.sh
#
# This is a real deployment, not a debug mode. The worker claims jobs by polling
# Supabase, so it does not need to be reachable from the internet — it drains the
# queue from a laptop exactly as it would from a server. The dashboard notices it
# through a heartbeat and shows "worker · polling".
#
# The catch is simply that work happens only while this is running.
#
# Secrets are saved to worker/.env on first run so you are not retyping them.
# That file is gitignored and never leaves your machine.

set -euo pipefail

ENV_FILE=".env"

step() { printf '\n\033[1m── %s\033[0m\n' "$1"; }
ok()   { printf '   \033[1mok\033[0m  %s\n' "$1"; }
fail() { printf '\n\033[1mSTOPPED:\033[0m %s\n\n' "$1" >&2; exit 1; }

case "$(uname -s)" in
  Darwin) OS=mac ;;
  Linux)  OS=linux ;;
  *)      OS=other ;;
esac

install_hint() {
  case "$OS" in
    mac)   printf '     brew install %s\n' "$1" ;;
    linux) printf '     sudo apt-get install -y %s\n' "$1" ;;
    *)     printf '     install %s and make sure it is on your PATH\n' "$1" ;;
  esac
}

# --- Preflight ---------------------------------------------------------------

step "Checking what is installed"

[ -f package.json ] && grep -q nexus-clips-worker package.json || fail \
  "This is not the worker directory. You are in $(pwd).
   Run it from inside the repository:
     cd youtube-short/worker && ./run-local.sh"

command -v node >/dev/null 2>&1 || fail \
  "Node.js is not installed. Get the LTS build from https://nodejs.org
   then close and reopen this terminal."

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
[ "$NODE_MAJOR" -ge 20 ] || fail \
  "Node $(node -v) is too old — this needs 20 or newer. https://nodejs.org"
ok "node $(node -v)"

MISSING=""
command -v ffmpeg  >/dev/null 2>&1 && ok "ffmpeg"  || MISSING="$MISSING ffmpeg"
command -v ffprobe >/dev/null 2>&1 || MISSING="$MISSING ffmpeg"
command -v yt-dlp  >/dev/null 2>&1 && ok "yt-dlp"  || MISSING="$MISSING yt-dlp"

if [ -n "$MISSING" ]; then
  printf '\n\033[1mSTOPPED:\033[0m missing:%s\n\n' "$MISSING"
  printf '   ffmpeg cuts and captions the video; yt-dlp fetches it.\n'
  printf '   Neither is optional, and neither ships with Node.\n\n'
  for tool in $(printf '%s' "$MISSING" | tr ' ' '\n' | sort -u); do
    printf '   %s:\n' "$tool"
    install_hint "$tool"
  done
  printf '\n   On Windows use winget: winget install ffmpeg / winget install yt-dlp\n\n'
  exit 1
fi

# --- Secrets -----------------------------------------------------------------

step "Credentials"

if [ -f "$ENV_FILE" ]; then
  ok "using the values saved in worker/$ENV_FILE"
  ok "delete that file if you need to change them"
else
  echo "   Saved to worker/$ENV_FILE so this is a one-time step."
  echo "   That file is gitignored — it stays on this machine."
  echo

  read -rp  "   SUPABASE_URL [https://pxglkushjutzbmlbbrbe.supabase.co]: " IN_URL
  IN_URL=${IN_URL:-https://pxglkushjutzbmlbbrbe.supabase.co}

  echo "   SUPABASE_SERVICE_ROLE_KEY — Supabase dashboard, Settings, API,"
  echo "   the key labelled service_role (not anon). Input is hidden."
  read -rsp "   > " IN_SERVICE; echo
  [ -n "$IN_SERVICE" ] || fail "The service_role key is required — without it the worker cannot claim jobs."

  echo "   OPENAI_API_KEY — for Whisper transcription. Hidden."
  read -rsp "   > " IN_OPENAI; echo

  echo "   ANTHROPIC_API_KEY — for scoring moments and writing hooks. Hidden."
  read -rsp "   > " IN_ANTHROPIC; echo

  # Written with restrictive permissions before anything is put in it.
  umask 077
  cat > "$ENV_FILE" <<EOF
# Written by run-local.sh. Gitignored. Delete this file to re-enter the values.
SUPABASE_URL=$IN_URL
SUPABASE_SERVICE_ROLE_KEY=$IN_SERVICE
OPENAI_API_KEY=$IN_OPENAI
ANTHROPIC_API_KEY=$IN_ANTHROPIC

# Nothing calls in to a local worker, so this only has to satisfy the config
# check. It does not need to match Vercel unless you also set WORKER_URL there.
WORKER_SHARED_SECRET=local-only-not-used

# Scratch space for video. Cleared after each job.
MEDIA_DIR=$(pwd)/.media
PORT=8080
EOF
  ok "saved worker/$ENV_FILE"
fi

set -a
# shellcheck disable=SC1090
. "./$ENV_FILE"
set +a

# --- Build -------------------------------------------------------------------

step "Installing dependencies"
npm install --silent || fail "npm install failed — the output above says why."
ok "dependencies installed"

step "Compiling"
npm run build --silent >/dev/null || fail "The TypeScript build failed."
ok "compiled"

mkdir -p "${MEDIA_DIR:-./.media}"

# --- Run ---------------------------------------------------------------------

step "Starting the worker"

cat <<'EOF'

   It polls Supabase every 60 seconds and picks up anything queued.
   The dashboard will show "worker · polling" within a minute or two.

   Leave this window open. Ctrl-C stops it; nothing is lost — an
   interrupted job is reclaimed and retried on the next run.

EOF

exec node dist/index.js
