#!/bin/sh

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"

if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1090
  . "$NVM_DIR/nvm.sh"
  nvm use 20 >/dev/null || exit 1
fi

major="$(node -p "process.versions.node.split('.')[0]" 2>/dev/null)"

if [ "$major" != "20" ]; then
  echo "F.U.N requires Node 20.x. Current Node is $(node -v 2>/dev/null || echo unknown)."
  echo 'Run: export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"; nvm use 20'
  exit 1
fi

export NEXT_TELEMETRY_DISABLED=1
exec "$@"
