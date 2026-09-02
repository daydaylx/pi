#!/bin/bash
# Builds environments/pi-product-stack.tar.gz: the real Pi product-stack
# files needed inside a Harbor trial container (see agents/pi_harness/agent.py
# docstring). Never includes auth.json or any other secret -- credentials
# are uploaded separately, per trial, by PiHarnessTrackA.run().
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="/home/d/.pi/agent"
out="$script_dir/pi-product-stack.tar.gz"

# MANIFEST.json: source-side version facts frozen at this exact build (Benchmark
# v3 Teil A1). Written to a scratch dir so it can be tarred in at the archive
# root alongside the repo_root-relative paths below.
manifest_dir="$(mktemp -d)"
trap 'rm -rf "$manifest_dir"' EXIT
python3 "$script_dir/../scripts/build_version_manifest.py" > "$manifest_dir/MANIFEST.json"

# Pre-resolved pi-subagents checkout at the exact path
# PI_CODING_AGENT_DIR/git/github.com/daydaylx/pi-subagents pi-coding-agent
# itself expects (see chunk-E5KXRMZK.js) -- ships it instead of letting the
# agent `git clone` it at runtime on first subagent spawn. Confirmed real,
# reproducible failure (2026-09-01, real Harbor trials, not a guess): that
# runtime clone hit the identical `fatal: could not read Username for
# 'https://github.com'` bug as nvm's own installer (see agent.py's node
# install env comment) -- this sandbox's git-over-https to github.com is
# unreliable, independent of which code path triggers it. The local
# checkout's HEAD already matches the exactly-pinned fork SHA used
# elsewhere (verified: both `11f3fcbc0e346f747df2bd8342d77cb8c9f8c962`).
# node_modules excluded -- a resolved copy already ships via npm/node_modules
# below; this location only needs to look like a valid, up-to-date clone.
git_stage_dir="$manifest_dir/git/github.com/daydaylx"
mkdir -p "$git_stage_dir"
rsync -a --exclude=node_modules "$repo_root/pi-subagents/" "$git_stage_dir/pi-subagents/"

cd "$repo_root"
tar czf "$out" \
  --exclude='npm/node_modules/.cache' \
  -C "$manifest_dir" MANIFEST.json git \
  -C "$repo_root" \
  AGENTS.md APPEND_SYSTEM.md settings.json models-store.json \
  agents/ extensions/ shared/ themes/ skills/ \
  npm/package.json npm/package-lock.json npm/node_modules

echo "Built $out ($(du -h "$out" | cut -f1))"
