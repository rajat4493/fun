#!/bin/sh
# Runs a command on the Node major pinned in .nvmrc (must match "engines" in package.json,
# which is what Vercel builds with). Locally, nvm switches to it when available.

required="$(tr -d ' \nv' < "$(dirname "$0")/../.nvmrc")"
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"

if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1090
  . "$NVM_DIR/nvm.sh"
  nvm use "$required" >/dev/null || exit 1
fi

major="$(node -p "process.versions.node.split('.')[0]" 2>/dev/null)"

if [ "$major" != "$required" ]; then
  echo "F.U.N requires Node $required.x. Current Node is $(node -v 2>/dev/null || echo unknown)."
  echo "Run: nvm install $required && nvm use $required"
  exit 1
fi

export NEXT_TELEMETRY_DISABLED=1
exec "$@"
