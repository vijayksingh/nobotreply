#!/usr/bin/env bash
set -euo pipefail

# Render tools/og-card.html -> public/og-image.png (1200x630).
#
# Chrome renders the SVG artwork and typography at 2x, then Pillow downsamples
# with Lanczos. Rendering at 1x leaves the small icons visibly soft; the
# supersample-then-downscale pass is what makes them crisp.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SRC="$SCRIPT_DIR/og-card.html"
OUT="$ROOT/public/og-image.png"
TMP="$(mktemp -d)/og@2x.png"

CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
[ -x "$CHROME" ] || { echo "Chrome not found at $CHROME (set CHROME=...)" >&2; exit 1; }

echo "[og] rendering at 2x (2400x1260)"
"$CHROME" --headless --disable-gpu --no-sandbox --hide-scrollbars \
  --user-data-dir="$(mktemp -d)" \
  --force-device-scale-factor=2 \
  --screenshot="$TMP" --window-size=1200,630 --virtual-time-budget=3000 \
  "file://$SRC" >/dev/null 2>&1 &
for _ in $(seq 1 90); do [ -s "$TMP" ] && break; sleep 0.5; done
sleep 1
pkill -f "og-card" 2>/dev/null || true
[ -s "$TMP" ] || { echo "[og] Chrome produced no screenshot" >&2; exit 1; }

echo "[og] downsampling to 1200x630"
python3 - "$TMP" "$OUT" <<'PY'
import sys
from PIL import Image
src, dst = sys.argv[1], sys.argv[2]
im = Image.open(src).convert("RGB")
print(f"  source {im.size[0]}x{im.size[1]}")
im = im.resize((1200, 630), Image.LANCZOS)
im.save(dst, "PNG", optimize=True)
print(f"  wrote {dst}  {im.size[0]}x{im.size[1]}")
PY

ls -la "$OUT" | awk '{printf "  %s  %.1f KB\n", $NF, $5/1024}'
