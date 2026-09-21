#!/usr/bin/env bash
set -euo pipefail

# Entry point for the GitHub Actions deploy key. Installed on platform-01 at
# /home/admin/bin/nobotreply-ci-deploy and pinned via a forced `command=` in
# authorized_keys, so this key can do exactly one thing and nothing else.
#
# Reads a gzipped tar of the repository on stdin, refreshes the working tree,
# then builds and deploys with the Cloudflare token, which never leaves this host.
DEST="$HOME/projects/nobotreply"
export COPYFILE_DISABLE=1

echo "[ci-deploy] receiving source"
mkdir -p "$DEST"
cd "$DEST"

# Remove the tracked source dirs before extracting so files deleted upstream
# actually disappear here, then unpack the incoming tree.
rm -rf content src public tools scripts .github dist
rm -f build.mjs package.json README.md .gitignore
tar xzf -
chmod +x scripts/* 2>/dev/null || true

echo "[ci-deploy] tree: $(find content -name '*.json' ! -name '._*' | wc -l) locales"
exec scripts/deploy.sh
