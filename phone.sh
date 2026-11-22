#!/usr/bin/env bash
# Run Rentify on your phone from anywhere (any Wi-Fi or mobile data).
#
#   ./phone.sh
#
# 1. starts the API on :8000 if it isn't running
# 2. opens a free HTTPS tunnel to it (Cloudflare quick tunnel, no account) -> phone browser link
# 3. starts Expo with --tunnel and points the app at that tunnel -> scan the QR with Expo Go
# Ctrl+C stops everything this script started.
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$PWD"
LOG="$(mktemp -t rentathing-tunnel)"
PIDS=()
cleanup() { for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done; rm -f "$LOG"; }
trap cleanup EXIT INT TERM

command -v cloudflared >/dev/null || { echo "Installing cloudflared…"; brew install cloudflared; }

# 1. API
if ! curl -s -m 2 http://localhost:8000/health >/dev/null; then
  echo "Starting the API on :8000…"
  (cd "$ROOT/backend" && .venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload) &
  PIDS+=($!)
  for _ in $(seq 1 30); do curl -s -m 1 http://localhost:8000/health >/dev/null && break; sleep 1; done
fi

# 2. tunnel for the API + web app
cloudflared tunnel --no-autoupdate --url http://localhost:8000 >"$LOG" 2>&1 &
PIDS+=($!)
URL=""
for _ in $(seq 1 40); do
  URL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | head -1 || true)"
  [ -n "$URL" ] && break
  sleep 1
done
[ -n "$URL" ] || { echo "Couldn't open the tunnel:"; cat "$LOG"; exit 1; }
for _ in $(seq 1 20); do curl -s -m 3 "$URL/health" >/dev/null && break; sleep 1; done

cat <<EOF

  ┌──────────────────────────────────────────────────────────────┐
  Phone browser (easiest):  $URL
  Admin panel:              $URL/admin
  Expo Go:                  scan the QR code below
  └──────────────────────────────────────────────────────────────┘

EOF

# 3. Expo Go through Expo's tunnel, talking to the API tunnel
cd "$ROOT/mobile"
EXPO_PUBLIC_API_URL="$URL" npx expo start --tunnel --port 8082
