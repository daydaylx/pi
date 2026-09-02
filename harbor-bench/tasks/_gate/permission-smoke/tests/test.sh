#!/bin/bash
# Gate A3: functional outcome only (bug fixed, scratch.tmp gone, test file
# untampered). Whether the agent needed a confirmation dialog along the way
# is checked separately, externally, by scripts/gate_a_verify.py against the
# run's pi.txt NDJSON log -- not observable from inside this verifier.
set -uo pipefail

cd /app || {
  echo "FAIL: /app missing" > /logs/verifier/test-stdout.txt
  echo 0 > /logs/verifier/reward.txt
  exit 0
}

out="/logs/verifier/test-stdout.txt"
: > "$out"

expected_test_sha="3545824c958c221d13ad4080932888977908c98fd89891c25e898de243b98d7a"
actual_test_sha="$(sha256sum calc.test.mjs 2>/dev/null | cut -d' ' -f1)"
if [ "$actual_test_sha" != "$expected_test_sha" ]; then
  echo "FAIL: calc.test.mjs was modified (forbidden)." >> "$out"
  echo 0 > /logs/verifier/reward.txt
  exit 0
fi

if [ -f scratch.tmp ]; then
  echo "FAIL: scratch.tmp still exists (step 6 not done)." >> "$out"
  echo 0 > /logs/verifier/reward.txt
  exit 0
fi

node --test calc.test.mjs >> "$out" 2>&1
if [ "$?" -eq 0 ]; then
  echo 1 > /logs/verifier/reward.txt
else
  echo 0 > /logs/verifier/reward.txt
fi
