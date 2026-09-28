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
  local ua="${6:-}"
  local hdr="$tmp/hdr" body="$tmp/body"
  local args=(-s -D "$hdr" -o "$body")
  if [ -n "$ua" ]; then
    args+=(-A "$ua")
  fi
  curl "${args[@]}" "$url" || true
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

expect_has() {
  local url="$1" want_status="$2" header_name="$3" header_mode="$4" header_want="$5" body_sub="$6" ua="$7"
  local hdr="$tmp/hdr" body="$tmp/body" got status
  curl -s -D "$hdr" -o "$body" -A "$ua" "$url" || true
  status=$(awk 'NR==1 { print $2 }' "$hdr" | tr -d '\r')
  got=$(header_value "$hdr" "$header_name")
  if [ "$status" != "$want_status" ]; then
    echo "status mismatch for $url"
    echo "expected: $want_status"
    echo "actual: $status"
    fail=$((fail + 1))
  fi
  if [ "$header_mode" = "prefix" ]; then
    case "$got" in
      "$header_want"*) ;;
      *)
        echo "header $header_name prefix mismatch for $url"
        echo "expected prefix: $header_want"
        echo "actual: $got"
        fail=$((fail + 1))
        ;;
    esac
  elif [ "$got" != "$header_want" ]; then
    echo "header $header_name mismatch for $url"
    echo "expected: $header_want"
    echo "actual: $got"
    fail=$((fail + 1))
  fi
  if [ -n "${8:-}" ]; then
    local extra
    extra=$(header_value "$hdr" "${8}")
    if [ "${9}" = "prefix" ]; then
      case "$extra" in
        "${10}"*) ;;
        *)
          echo "header ${8} prefix mismatch for $url"
          echo "expected prefix: ${10}"
          echo "actual: $extra"
          fail=$((fail + 1))
          ;;
      esac
    elif [ "$extra" != "${10}" ]; then
      echo "header ${8} mismatch for $url"
      echo "expected: ${10}"
      echo "actual: $extra"
      fail=$((fail + 1))
    fi
  fi
  if [ "$body_sub" != "-" ] && ! grep -F -q -- "$body_sub" "$body"; then
    echo "body substring missing for $url"
    echo "expected: $body_sub"
    fail=$((fail + 1))
  fi
}

expect_resp \
  'http://127.0.0.1:8799/?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ%26t%3D42%26si%3Dabc' \
  200 \
  'text/plain; charset=utf-8' \
  - \
  'http://127.0.0.1:8799/www.youtube.com/watch?v=dQw4w9WgXcQ&t=42'

expect_resp 'http://127.0.0.1:8799/favicon.ico' 404 - - -

expect_resp \
  'http://127.0.0.1:8799/www.instagram.com/p/ABC/?img_index=2&igsh=xyz' \
  302 \
  - \
  'https://www.instagram.com/p/ABC/?img_index=2' \
  - \
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'

expect_resp \
  'http://127.0.0.1:8799/example.com/a?q=a%20b&r=c~d&t=x+y&fbclid=1' \
  302 \
  - \
  'https://example.com/a?q=a%20b&r=c~d&t=x+y' \
  -

expect_resp \
  'http://127.0.0.1:8799/?url=https%3A%2F%2Fwww.facebook.com%2Fshare%2Fp%2F1Fu5ScGFUZ%2F' \
  200 \
  'text/plain; charset=utf-8' \
  - \
  'http://127.0.0.1:8799/www.facebook.com/mannynewsletter/posts/pfbid02w1fJYqdqq36s8V1wsTDognPKniCQ8E6BkEzHehiNe1zWZxgB67EV4Nz9cyLxtnqol'

expect_resp \
  'http://127.0.0.1:8799/x.com/jack/status/20?s=20&utm_source=x' \
  302 \
  - \
  'https://fixupx.com/jack/status/20?s=20' \
  - \
  'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)'

expect_resp \
  'http://127.0.0.1:8799/x.com/jack/status/20?s=20&utm_source=x' \
  302 \
  - \
  'https://x.com/jack/status/20?s=20' \
  - \
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'


expect_has \
  'http://127.0.0.1:8799/www.instagram.com/p/BsOGulcndj-/' \
  200 \
  content-type \
  exact \
  'text/html; charset=utf-8' \
  '<meta property="og:image" content="http://127.0.0.1:8799/media/BsOGulcndj-/1">' \
  'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)'

expect_has \
  'http://127.0.0.1:8799/media/BsOGulcndj-/1' \
  302 \
  location \
  prefix \
  'https://scontent.cdninstagram.com/' \
  - \
  'Mozilla/5.0' \
  cache-control \
  exact \
  'no-store'
expect_has \
  'http://127.0.0.1:8799/www.instagram.com/p/DOBXTYNklfi/2' \
  200 \
  content-type \
  exact \
  'text/html; charset=utf-8' \
  '<meta property="og:image" content="http://127.0.0.1:8799/media/DOBXTYNklfi/2">' \
  'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)'

expect_has \
  'http://127.0.0.1:8799/www.instagram.com/reel/DJvkjAlvNc8/' \
  200 \
  content-type \
  exact \
  'text/html; charset=utf-8' \
  '<meta property="og:video" content="http://127.0.0.1:8799/media/DJvkjAlvNc8/1">' \
  'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)'

expect_has \
  'http://127.0.0.1:8799/www.instagram.com/p/DJvkjAlvNc8/' \
  200 \
  content-type \
  exact \
  'text/html; charset=utf-8' \
  '<meta property="og:video" content="http://127.0.0.1:8799/media/DJvkjAlvNc8/1">' \
  'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)'

if [ "$fail" -ne 0 ]; then
  exit 1
fi
