#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

mkdir -p .wrangler/home
export HOME="$PWD/.wrangler/home"

./node_modules/.bin/wrangler --version

mkdir -p .wrangler
WRANGLER_SEND_METRICS=false ./node_modules/.bin/wrangler dev --ip 127.0.0.1 --port 8799 >.wrangler/smoke.log 2>&1 &
pid=$!
tmp=$(mktemp -d)
cleanup() {
  kill "$pid" 2>/dev/null || true
  rm -rf "$tmp"
}
trap cleanup EXIT

ready=0
for _ in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8799/ || true)
  if [ "$code" = "400" ]; then
    ready=1
    break
  fi
  sleep 1
done
if [ "$ready" -ne 1 ]; then
  echo "wrangler dev did not become ready" >&2
  tail -n 80 .wrangler/smoke.log >&2 || true
  exit 1
fi

fail=0

header_value() {
  local file="$1" name="$2"
  awk -v name="$name" 'BEGIN { IGNORECASE = 1 }
    tolower($0) ~ "^" tolower(name) ":" {
      sub(/^[^:]*:[[:space:]]*/, "")
      sub(/\r$/, "")
      print
      exit
    }' "$file"
}

expect_resp() {
  local url="$1" want_status="$2" want_ct="$3" want_loc="$4" want_body="$5"
  local hdr="$tmp/hdr" body="$tmp/body"
  curl -s -D "$hdr" -o "$body" "$url" || true
  local status ct loc
  status=$(awk 'NR==1 { print $2 }' "$hdr" | tr -d '\r')
  ct=$(header_value "$hdr" content-type)
  loc=$(header_value "$hdr" location)
  if [ "$status" != "$want_status" ]; then
    echo "status mismatch for $url"
    echo "expected: $want_status"
    echo "actual: $status"
    fail=$((fail + 1))
  fi
  if [ "$want_ct" != "-" ] && [ "$ct" != "$want_ct" ]; then
    echo "content-type mismatch for $url"
    echo "expected: $want_ct"
    echo "actual: $ct"
    fail=$((fail + 1))
  fi
  if [ "$want_loc" != "-" ] && [ "$loc" != "$want_loc" ]; then
    echo "location mismatch for $url"
    echo "expected: $want_loc"
    echo "actual: $loc"
    fail=$((fail + 1))
  fi
  if [ "$want_body" != "-" ]; then
    printf '%s' "$want_body" >"$tmp/want"
    if ! cmp -s "$tmp/want" "$body"; then
      echo "body mismatch for $url"
      echo "expected: $want_body"
      echo -n "actual: "
      cat "$body"
      echo
      fail=$((fail + 1))
    fi
  fi
}

expect_resp \
  'http://127.0.0.1:8799/?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ%26t%3D42%26si%3Dabc' \
  200 \
  'text/plain; charset=utf-8' \
  - \
  'http://127.0.0.1:8799/www.youtube.com/watch?v=dQw4w9WgXcQ&t=42'

expect_resp 'http://127.0.0.1:8799/favicon.ico' 404 - - -

if [ "$fail" -ne 0 ]; then
  exit 1
fi
