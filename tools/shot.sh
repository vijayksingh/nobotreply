#!/bin/bash
# shot.sh <url> <out.png> <w> <h>
# Headless Chrome on macOS does not always exit after writing the screenshot, so
# poll for the file and then kill it rather than waiting on the process.
# Flag set matters: `--headless=new` traps on this machine, plain `--headless` works.
set -u
url=$1; out=$2; w=${3:-760}; h=${4:-1200}
prof=$(mktemp -d)
rm -f "$out"
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless --disable-gpu --no-sandbox --hide-scrollbars \
  --user-data-dir="$prof" \
  --screenshot="$out" --window-size="$w,$h" --virtual-time-budget=3000 \
  "$url" >/dev/null 2>&1 &
for _ in $(seq 1 90); do
  [ -s "$out" ] && break
  sleep 0.5
done
sleep 1
pkill -f "user-data-dir=$prof" 2>/dev/null
sleep 0.3
rm -rf "$prof"
if [ -s "$out" ]; then echo "  ok   $out  ($(wc -c <"$out") bytes)"; else echo "  FAIL $out"; fi
