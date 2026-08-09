# One-shot Fly deploy for the Nexus Clips worker - Windows PowerShell.
#
# IMPORTANT, and the reason this file is plain ASCII with a byte-order mark:
# Windows PowerShell 5.1 reads a .ps1 as ANSI unless it starts with a UTF-8 BOM.
# An em dash saved as UTF-8 then arrives as three Windows-1252 characters, one
# of which is a quote, which terminates a string early and makes the whole file
# fail to parse with errors that point at innocent lines. Keep this file ASCII.
#   cd youtube-short\worker
#   .\deploy-fly.ps1
#
# The bash version of this (deploy-fly.sh) does the same thing on Mac and Linux.
# This one is written for Windows PowerShell 5.1, the one that ships with
# Windows, so it avoids the newer syntax that only PowerShell 7 understands.
#
# It reads the app name, region and volume out of fly.toml so there is nothing
# to keep in sync by hand, stops at the first failure rather than leaving a
# half-built app, and skips anything that already exists - so it is safe to run
# again after fixing something.

# Deliberately NOT 'Stop'.
#
# flyctl writes progress and warnings to stderr as a matter of course - a
# telemetry warning, a deprecation notice, the build log. With
# $ErrorActionPreference = 'Stop', PowerShell turns every one of those lines
# into a terminating error, so the script dies on output that means nothing.
#
# Exit codes are the only trustworthy signal from a native tool, and every fly
# call below checks $LASTEXITCODE explicitly.
$ErrorActionPreference = "Continue"

function Write-Step($text) {
  Write-Host ""
  Write-Host "-- $text" -ForegroundColor White
}

function Write-Ok($text) {
  Write-Host "   ok  $text" -ForegroundColor DarkGray
}

function Stop-With($text) {
  Write-Host ""
  Write-Host "STOPPED: $text" -ForegroundColor Red
  Write-Host ""
  exit 1
}

# Reads a hidden value and returns it as ordinary text. PowerShell 5.1 has no
# -MaskInput, so the SecureString has to be unwrapped by hand.
function Read-Hidden($prompt) {
  $secure = Read-Host -Prompt $prompt -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringAuto($ptr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  }
}

# Pulls a quoted value out of a `key = "value"` line in fly.toml.
function Get-TomlValue($lines, $key) {
  foreach ($line in $lines) {
    if ($line -match ('^\s*' + [regex]::Escape($key) + '\s*=\s*"([^"]+)"')) {
      return $Matches[1]
    }
  }
  return ""
}

# --- Preflight ---------------------------------------------------------------

Write-Step "Checking prerequisites"

if (-not (Get-Command fly -ErrorAction SilentlyContinue)) {
  Stop-With @"
flyctl is not installed, or this window was opened before it was.

  Install:  iwr https://fly.io/install.ps1 -useb | iex
  Then CLOSE this window and open a new PowerShell.
"@
}
Write-Ok "flyctl found"

if (-not (Test-Path "fly.toml")) {
  Stop-With @"
No fly.toml in this folder. You are in:
  $(Get-Location)

Open the worker folder first, for example:
  cd `$HOME\youtube-short\worker
  .\deploy-fly.ps1
"@
}

fly auth whoami 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { Stop-With "Not signed in to Fly. Run:  fly auth login" }
Write-Ok "signed in"

$toml   = Get-Content "fly.toml"
$app    = Get-TomlValue $toml "app"
$region = Get-TomlValue $toml "primary_region"
$volume = Get-TomlValue $toml "source"

if ([string]::IsNullOrWhiteSpace($app)) { Stop-With "Could not read the app name out of fly.toml." }
if ([string]::IsNullOrWhiteSpace($volume)) { $volume = "nexus_media" }

$url = "https://$app.fly.dev"

Write-Host ""
Write-Host "   app:    $app"
Write-Host "   region: $region"
Write-Host "   volume: $volume"
Write-Host "   URL:    $url"

# --- Region ------------------------------------------------------------------

Write-Step "Checking the region"

# This check warns; it never stops. `fly platform regions` prints a table whose
# column order is Fly's business, not ours - an earlier version anchored the
# match to the start of the line, which meant a perfectly valid "lhr" was
# rejected because the name column comes first. A check built on parsing someone
# else's output cannot be trusted over their own error message, and fly launch
# reports a bad region clearly enough on its own.
$regionList = fly platform regions 2>$null | Out-String
if ($LASTEXITCODE -eq 0 -and $regionList -match "\S") {
  if ($regionList -match ("(?m)\b" + [regex]::Escape($region) + "\b")) {
    Write-Ok "$region looks valid"
  } else {
    Write-Host ""
    Write-Host "   Could not find '$region' in Fly's region list:" -ForegroundColor Yellow
    Write-Host $regionList
    Write-Host "   Continuing anyway - fly will reject it if it is genuinely wrong." -ForegroundColor Yellow
    Write-Host "   If it does, pick a code from that list, put it in the"
    Write-Host "   primary_region = line of fly.toml, and run this again."
  }
} else {
  Write-Ok "could not list regions - continuing"
}

# --- App ---------------------------------------------------------------------

Write-Step "Creating the app (skipped if it already exists)"

fly status --app $app 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) {
  Write-Ok "already exists"
} else {
  # --no-deploy because the volume and secrets have to exist first. A deploy
  # without them fails in ways that do not point back at the cause.
  fly launch --no-deploy --copy-config --name $app --region $region --yes
  if ($LASTEXITCODE -ne 0) {
    Stop-With @"
Could not create the app. Two things usually cause this:

  - the name is taken. Fly app names are unique across every account.
    Change the  app =  line in fly.toml and run this again.

  - the region code is wrong. Run  fly platform regions  to see the real
    list, then change the  primary_region =  line in fly.toml to match.
"@
  }
  Write-Ok "created"
}

# --- Volume ------------------------------------------------------------------

Write-Step "Creating the volume (skipped if it already exists)"

# fly.toml declares [mounts]; a deploy fails outright if that volume is absent.
$volumes = fly volumes list --app $app 2>$null | Out-String
if ($volumes -match [regex]::Escape($volume)) {
  Write-Ok "already exists"
} else {
  fly volumes create $volume --app $app --region $region --size 20 --yes
  if ($LASTEXITCODE -ne 0) { Stop-With "Could not create the volume." }
  Write-Ok "created"
}

# --- Secrets -----------------------------------------------------------------

Write-Step "Setting secrets"

Write-Host "   Paste each value and press Enter. Hidden entries show nothing as you type,"
Write-Host "   which is normal - paste and press Enter."
Write-Host ""

$serviceKey = Read-Hidden "   SUPABASE_SERVICE_ROLE_KEY (Supabase, Settings, API, the service_role key)"
if ([string]::IsNullOrWhiteSpace($serviceKey)) {
  Stop-With "The service_role key is required - without it the worker cannot claim any jobs."
}

$openaiKey = Read-Hidden "   OPENAI_API_KEY (Whisper transcription)"

Write-Host ""
Write-Host "   ANTHROPIC_API_KEY is optional. Press Enter to skip it."
Write-Host "   Without it the pipeline still runs: moments are ranked on audio energy"
Write-Host "   rather than on craft, and hooks come from the transcript."
Write-Host "   Add it later with:  fly secrets set ANTHROPIC_API_KEY=... --app $app"
$anthropicKey = Read-Hidden "   ANTHROPIC_API_KEY (press Enter to skip)"

$supabaseUrl = Read-Host "   SUPABASE_URL [https://pxglkushjutzbmlbbrbe.supabase.co]"
if ([string]::IsNullOrWhiteSpace($supabaseUrl)) {
  $supabaseUrl = "https://pxglkushjutzbmlbbrbe.supabase.co"
}

$sharedSecret = Read-Host "   WORKER_SHARED_SECRET (must match Vercel)"
if ([string]::IsNullOrWhiteSpace($sharedSecret)) { Stop-With "WORKER_SHARED_SECRET is required." }

# Only send keys that were given. An empty secret is not the same as an absent
# one - the worker checks for a non-empty value to decide what is available.
$secretArgs = @(
  "WORKER_SHARED_SECRET=$sharedSecret",
  "SUPABASE_URL=$supabaseUrl",
  "SUPABASE_SERVICE_ROLE_KEY=$serviceKey"
)
if (-not [string]::IsNullOrWhiteSpace($openaiKey))    { $secretArgs += "OPENAI_API_KEY=$openaiKey" }
if (-not [string]::IsNullOrWhiteSpace($anthropicKey)) { $secretArgs += "ANTHROPIC_API_KEY=$anthropicKey" }

fly secrets set --app $app --stage @secretArgs
if ($LASTEXITCODE -ne 0) { Stop-With "Could not set the secrets." }
Write-Ok "secrets staged"

if ([string]::IsNullOrWhiteSpace($anthropicKey)) {
  Write-Ok "no Anthropic key - audio-only ranking, transcript-derived hooks"
}

# --- Deploy ------------------------------------------------------------------

Write-Step "Building and deploying (several minutes - the build runs on Fly, not here)"

fly deploy --app $app
if ($LASTEXITCODE -ne 0) {
  Stop-With @"
The deploy failed. The build log above says why.
Copy the last 30 lines or so - that is what is needed to diagnose it.
"@
}

# --- Verify ------------------------------------------------------------------

Write-Step "Verifying"

Write-Host "   Waiting for the machine to answer..."

$healthy = $false
for ($i = 1; $i -le 20; $i++) {
  try {
    $body = (Invoke-WebRequest -Uri "$url/health" -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop).Content
    if ($body -match "nexus-clips-worker") { $healthy = $true; break }
  } catch {
    # Still booting. Fly machines take a few seconds to accept connections.
  }
  Start-Sleep -Seconds 6
}

if (-not $healthy) {
  Stop-With @"
Deployed, but $url/health never answered.

  See why:  fly logs --app $app

A crash on boot is almost always a wrong or missing secret. The worker now
refuses to start when it cannot read the database, and says so in the log.
"@
}

Write-Host ""
Write-Host "   The worker is up." -ForegroundColor Green
Write-Host ""
Write-Host "=============================================================="
Write-Host "  Add these in Vercel, Settings, Environment Variables,"
Write-Host "  then REDEPLOY - new variables never reach a running deploy."
Write-Host ""
Write-Host "    WORKER_URL=$url"
Write-Host "    WORKER_SHARED_SECRET=$sharedSecret"
Write-Host "    SUPABASE_SERVICE_ROLE_KEY=(the same one you just pasted)"
Write-Host "=============================================================="
Write-Host ""
