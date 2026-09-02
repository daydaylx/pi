#!/bin/bash
# Builds environments/codex-cli.tar.gz: a real, already-installed local
# Codex CLI (npm global install, including its resolved platform-specific
# optional dependency, e.g. @openai/codex-linux-x64) packaged for upload
# into a Harbor trial container -- mirrors build-tarball.sh's approach for
# Pi (agents/pi_harness/agent.py). Avoids Harbor's own Codex adapter
# (harbor.agents.installed.codex:Codex.install()) downloading the same
# ~310MB platform binary fresh, over the network, inside every single
# trial container -- confirmed unreliable in this sandbox
# (KNOWN_LIMITATIONS.md, network entries): the platform binary alone
# (npm registry metadata: unpackedSize ~332MB) reliably exceeds this
# environment's observed egress bandwidth/stability within npm's own
# internal optional-dependency timeout.
#
# Never includes credentials -- Codex auth (auth.json) is handled entirely
# separately by Harbor's own Codex._resolve_auth_json_path()/run(), unchanged
# by this tarball or by agents/codex_harness/agent.py.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
out="$script_dir/codex-cli.tar.gz"

local_codex_dir="$(npm root -g)/@openai/codex"
if [ ! -d "$local_codex_dir" ]; then
  echo "Local Codex CLI not found at $local_codex_dir -- install it first (npm install -g @openai/codex)." >&2
  exit 1
fi

local_version="$(node -e "console.log(require('$local_codex_dir/package.json').version)")"

tar czf "$out" -C "$(dirname "$local_codex_dir")" codex
echo "Built $out ($(du -h "$out" | cut -f1)), local Codex version $local_version"
