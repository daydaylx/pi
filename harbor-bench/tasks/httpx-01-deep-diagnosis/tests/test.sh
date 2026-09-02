#!/bin/bash
# Verifies HTTPX Task 1 (Deep Repository Diagnosis). Two independent checks,
# both must pass:
#   1. The hidden test (this directory's sibling file, copied to /tests/ by
#      Harbor for the verifier phase, never visible to the agent) directly
#      exercises the reported symptom.
#   2. httpx's own full public test suite must still be clean (minus the
#      one known, upstream-acknowledged flaky test documented in
#      HTTPX_BASELINE.md) -- catches a fix that patches the symptom but
#      introduces a regression elsewhere (empirically confirmed during task
#      design: an "always merge unconditionally" non-fix passes check 1 but
#      fails 4 tests in tests/client/test_redirects.py under check 2).
set -uo pipefail

cd /app || {
  echo "FAIL: /app missing" > /logs/verifier/test-stdout.txt
  echo 0 > /logs/verifier/reward.txt
  exit 0
}

out="/logs/verifier/test-stdout.txt"
: > "$out"

expected_queryparams_test_sha="2bf5b34b367752750069016b1feccc9e59d1de20f5fd76cb4e0be31282ef3f79"
actual_queryparams_test_sha="$(sha256sum tests/client/test_queryparams.py 2>/dev/null | cut -d' ' -f1)"
if [ "$actual_queryparams_test_sha" != "$expected_queryparams_test_sha" ]; then
  {
    echo "FAIL: tests/client/test_queryparams.py was modified (forbidden)."
    echo "Only fix the underlying bug; do not weaken or remove existing tests."
  } >> "$out"
  echo 0 > /logs/verifier/reward.txt
  exit 0
fi

echo "--- hidden test ---" >> "$out"
python -m pytest -q /tests/hidden_test_deep_diagnosis.py >> "$out" 2>&1
hidden_status=$?

echo "--- full public suite (excluding known flaky test, see HTTPX_BASELINE.md) ---" >> "$out"
python -m pytest -q --deselect 'tests/test_timeouts.py::test_write_timeout[trio]' >> "$out" 2>&1
public_status=$?

if [ "$hidden_status" -eq 0 ] && [ "$public_status" -eq 0 ]; then
  echo 1 > /logs/verifier/reward.txt
else
  echo 0 > /logs/verifier/reward.txt
fi
