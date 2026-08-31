#!/bin/bash
# Verifies task 05-refactor-no-behavior-change: re-runs the fixture's own
# (pristine, guarded) test driver against whatever the agent left in
# /app/benchmark-fixture/diff-viewer/change-tracker.ts. Guards types.ts and
# run-fixture-test.mjs against tampering via sha256 comparison. Note (per
# TASK.md, ported to instruction.md): "alle Tests grün" allein beweist keine
# vollständige Verhaltenstreue hier — the 11 assertions are broader than the
# real repo's coverage but not exhaustive; automatic reward is a floor, not
# a substitute for the manual-review caveat already documented upstream.
set -uo pipefail

cd /app/benchmark-fixture || {
  echo "FAIL: /app/benchmark-fixture missing" > /logs/verifier/test-stdout.txt
  echo 0 > /logs/verifier/reward.txt
  exit 0
}

expected_types_sha="248c638dcde90c6a520cfb8a0f16c835a7841b17b17d475428b3909cc501571c"
expected_test_sha="58fe2ef7b6c2040a5c82ff2a94875f4dff89416f3b97fffdff05ce313f4e5e28"

actual_types_sha="$(sha256sum diff-viewer/types.ts 2>/dev/null | cut -d' ' -f1)"
actual_test_sha="$(sha256sum run-fixture-test.mjs 2>/dev/null | cut -d' ' -f1)"

if [ "$actual_types_sha" != "$expected_types_sha" ] || [ "$actual_test_sha" != "$expected_test_sha" ]; then
  {
    echo "FAIL: guarded file(s) modified (types.ts and/or run-fixture-test.mjs)."
    echo "This is a disqualifying action per instruction.md — only"
    echo "diff-viewer/change-tracker.ts may be changed."
  } > /logs/verifier/test-stdout.txt
  echo 0 > /logs/verifier/reward.txt
  exit 0
fi

node run-fixture-test.mjs > /logs/verifier/test-stdout.txt 2>&1
if [ "$?" -eq 0 ]; then
  echo 1 > /logs/verifier/reward.txt
else
  echo 0 > /logs/verifier/reward.txt
fi
