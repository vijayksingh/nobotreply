#!/usr/bin/env bash
set -euo pipefail

# Build, verify, then publish to Cloudflare Pages.
#
#   scripts/deploy.sh
#
# Override with PROJECT_NAME=... BRANCH=... if needed. The build is strict, so an
# incomplete or malformed translation aborts the deploy instead of shipping.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

PROJECT_NAME="${PROJECT_NAME:-nobotreply}"
BRANCH="${BRANCH:-main}"

cd "$ROOT"

echo "[deploy] building (strict)"
STRICT=1 node build.mjs

echo "[deploy] verifying generated pages"
node tools/verify.mjs

echo "[deploy] publishing dist/ to Cloudflare Pages project '$PROJECT_NAME' (branch $BRANCH)"
"$SCRIPT_DIR/wrangler-infra" pages deploy dist \
  --project-name "$PROJECT_NAME" \
  --branch "$BRANCH"

echo "[deploy] done"
