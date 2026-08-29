#!/usr/bin/env bash
# Test-only: lädt ausschließlich die kontrollierte RPC-Dialog-Fixture.
set -euo pipefail

: "${PI_GUI_DIALOG_SMOKE_PI:?Pi-Pfad fehlt}"
: "${PI_GUI_DIALOG_SMOKE_EXTENSION:?Extension-Pfad fehlt}"
exec "$PI_GUI_DIALOG_SMOKE_PI" \
  --no-extensions \
  --extension "$PI_GUI_DIALOG_SMOKE_EXTENSION" \
  "$@"
