#!/bin/bash
set -euo pipefail
sed -i 's/index - last < contextLines \* 2 + 1/index - last <= contextLines * 2 + 1/' \
  /app/benchmark-fixture/diff-viewer/diff-algorithm.ts
