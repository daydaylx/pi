#!/bin/bash
# Builds environments/pi-product-stack.tar.gz: the real Pi product-stack
# files needed inside a Harbor trial container (see agents/pi_harness/agent.py
# docstring). Never includes auth.json or any other secret -- credentials
# are uploaded separately, per trial, by PiHarnessTrackA.run().
set -euo pipefail

repo_root="/home/d/.pi/agent"
out="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/pi-product-stack.tar.gz"

cd "$repo_root"
tar czf "$out" \
  --exclude='npm/node_modules/.cache' \
  AGENTS.md APPEND_SYSTEM.md settings.json models-store.json \
  agents/ extensions/ shared/ themes/ \
  npm/package.json npm/package-lock.json npm/node_modules

echo "Built $out ($(du -h "$out" | cut -f1))"
