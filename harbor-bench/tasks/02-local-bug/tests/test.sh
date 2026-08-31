#!/bin/bash
# Verifies task 02-local-bug: re-runs the fixture's own (pristine, guarded)
# test driver against whatever the agent left in
# /app/benchmark-fixture/diff-viewer/diff-algorithm.ts. Guards types.ts and
# run-fixture-test.mjs against tampering (both are explicitly forbidden to
# change per instruction.md / benchmarks/tasks/02-local-bug/TASK.md
# "Verbotene Änderungen") via sha256 comparison against the known-good
# fixture content.
set -uo pipefail

cd /app/benchmark-fixture || {
  echo "FAIL: /app/benchmark-fixture missing" > /logs/verifier/test-stdout.txt
  echo 0 > /logs/verifier/reward.txt
  exit 0
}

expected_types_sha="248c638dcde90c6a520cfb8a0f16c835a7841b17b17d475428b3909cc501571c"
expected_test_sha="2a02b7bc15925d2c81967d69107dc21000b635fe5f238ce097264459d2ab787e"

actual_types_sha="$(sha256sum diff-viewer/types.ts 2>/dev/null | cut -d' ' -f1)"
actual_test_sha="$(sha256sum run-fixture-test.mjs 2>/dev/null | cut -d' ' -f1)"

if [ "$actual_types_sha" != "$expected_types_sha" ] || [ "$actual_test_sha" != "$expected_test_sha" ]; then
  {
    echo "FAIL: guarded file(s) modified (types.ts and/or run-fixture-test.mjs)."
    echo "This is a disqualifying action per instruction.md — only"
    echo "diff-viewer/diff-algorithm.ts may be changed."
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
