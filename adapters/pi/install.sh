#!/bin/sh
# Symlink the Taint Blame extension into pi's global extensions dir and write the adapter config.
set -eu
HERE="$(cd "$(dirname "$0")" && pwd -P)"
REPO="$(cd "$HERE/../.." && pwd -P)"
mkdir -p "$HOME/.pi/agent/extensions"
ln -sfn "$HERE/taint-blame.ts" "$HOME/.pi/agent/extensions/taint-blame.ts"
if [ ! -f "$HOME/.taint-blame/config.env" ] && [ -f "$REPO/.env.adapter" ]; then
  mkdir -p "$HOME/.taint-blame" && chmod 700 "$HOME/.taint-blame"
  grep -E '^TAINT_BLAME_(URL|TOKEN)=' "$REPO/.env.adapter" > "$HOME/.taint-blame/config.env"
  chmod 600 "$HOME/.taint-blame/config.env"
fi
echo "Linked $HOME/.pi/agent/extensions/taint-blame.ts -> $HERE/taint-blame.ts"
