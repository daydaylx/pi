#!/bin/bash
# Gate A2: git must work (not "fatal: not a git repository"), the agent must
# have actually committed the requested change, and the working tree must be
# clean afterwards (proves a real commit, not just a staged/dirty edit).
set -uo pipefail

cd /app || {
  echo "FAIL: /app missing" > /logs/verifier/test-stdout.txt
  echo 0 > /logs/verifier/reward.txt
  exit 0
}

out="/logs/verifier/test-stdout.txt"
: > "$out"

if ! git rev-parse --is-inside-work-tree >> "$out" 2>&1; then
  echo "FAIL: git rev-parse failed -- not a git repository" >> "$out"
  echo 0 > /logs/verifier/reward.txt
  exit 0
fi

commit_count="$(git log --oneline 2>>"$out" | wc -l)"
echo "commit_count=$commit_count" >> "$out"
if [ "$commit_count" -lt 2 ]; then
  echo "FAIL: expected >=2 commits (baseline + agent commit), got $commit_count" >> "$out"
  echo 0 > /logs/verifier/reward.txt
  exit 0
fi

if ! grep -q "agent was here" notes.txt 2>>"$out"; then
  echo "FAIL: notes.txt does not contain the expected line" >> "$out"
  echo 0 > /logs/verifier/reward.txt
  exit 0
fi

dirty="$(git status --porcelain 2>>"$out")"
if [ -n "$dirty" ]; then
  echo "FAIL: working tree not clean after commit: $dirty" >> "$out"
  echo 0 > /logs/verifier/reward.txt
  exit 0
fi

echo "PASS" >> "$out"
echo 1 > /logs/verifier/reward.txt
