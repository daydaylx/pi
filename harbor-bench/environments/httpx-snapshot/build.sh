#!/bin/bash
# Builds the reusable httpx snapshot Docker image (Benchmark v3 Teil B4):
# one image, referenced by every HTTPX task's task.toml via
# [environment] docker_image = "<tag>" instead of a per-task Dockerfile
# build. Re-run after HTTPX_BASELINE.md's pinned SHA changes; never
# silently re-pins to a newer commit on its own.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$script_dir/../../repos/httpx"
context="$script_dir/context"
sha="b5addb64f0161ff6bfe94c124ef76f6a1fba5254"  # HTTPX_BASELINE.md HTTPX_BASE_SHA
tag="httpx-snapshot:${sha:0:8}"

if [ ! -d "$repo/.git" ]; then
  echo "error: $repo is not a git checkout -- see HTTPX_BASELINE.md to clone it first" >&2
  exit 1
fi

actual_sha="$(git -C "$repo" rev-parse HEAD)"
if [ "$actual_sha" != "$sha" ]; then
  echo "error: $repo HEAD is $actual_sha, expected pinned $sha (HTTPX_BASELINE.md)" >&2
  echo "  run: git -C '$repo' checkout $sha" >&2
  exit 1
fi

rm -rf "$context/httpx-src"
mkdir -p "$context/httpx-src"
git -C "$repo" archive --format=tar "$sha" | tar -x -C "$context/httpx-src"

freeze_src="$repo/venv/bin/pip"
if [ -x "$freeze_src" ]; then
  "$freeze_src" freeze > "$context/baseline-freeze.txt"
else
  echo "warning: $repo/venv not found, reusing existing baseline-freeze.txt as-is" >&2
fi

docker build -t "$tag" "$context"
echo "Built $tag"
echo "Reference it in a task's task.toml as:"
echo '  [environment]'
echo "  docker_image = \"$tag\""
