#!/usr/bin/env bash
set -euo pipefail

# Sync this working tree to the infra machine and deploy from there.
# Runs on the Mac; requires the `vm-agent` ssh alias.
#
#   scripts/push.sh          # sync + build + verify + deploy
#   scripts/push.sh --sync   # sync only
#
# Notes baked in the hard way:
#   * COPYFILE_DISABLE=1 stops macOS tar emitting `._*` AppleDouble stubs.
#   * `-T -o RemoteCommand=none` because the host sets RequestTTY + RemoteCommand
#     (it auto-attaches to a tmux codex session) which otherwise swallows stdin.
#   * the remote source dirs are deleted before extracting, so files removed here
#     actually disappear there instead of lingering and being served.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REMOTE="${REMOTE:-vm-agent}"
REMOTE_DIR="${REMOTE_DIR:-projects/nobotreply}"
SSH_OPTS=(-T -o RemoteCommand=none)

cd "$ROOT"

remote() { ssh "${SSH_OPTS[@]}" "$REMOTE" "$@"; }

echo "[push] syncing source to $REMOTE:$REMOTE_DIR"
export COPYFILE_DISABLE=1
tar czf - \
  --exclude='._*' --exclude='.DS_Store' --exclude=dist --exclude=node_modules \
  --exclude=.npm-cache --exclude=.git \
  build.mjs package.json content src public tools scripts README.md .gitignore .github \
  | remote "set -e
      mkdir -p ~/$REMOTE_DIR
      cd ~/$REMOTE_DIR
      rm -rf content src public tools scripts .github
      rm -f build.mjs package.json README.md .gitignore
      tar xzf -
      chmod +x scripts/* 2>/dev/null || true
      echo '[push] remote tree:' \$(ls)"

if [ "${1:-}" = "--sync" ]; then
  echo "[push] sync only, not deploying"
  exit 0
fi

echo "[push] building and deploying on $REMOTE"
remote "cd ~/$REMOTE_DIR && scripts/deploy.sh"
echo "[push] done"
