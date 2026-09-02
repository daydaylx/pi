#!/bin/bash
# Verifies HTTPX Task 4 (Authentication State Bug). Same two-check pattern
# as Task 1/2/3: hidden test for the direct symptom, full public suite for
# regressions (see tasks/httpx-01-deep-diagnosis/tests/test.sh).
set -uo pipefail

cd /app || {
  echo "FAIL: /app missing" > /logs/verifier/test-stdout.txt
  echo 0 > /logs/verifier/reward.txt
  exit 0
}

out="/logs/verifier/test-stdout.txt"
: > "$out"

expected_auth_test_sha="428600a96647081d2e331d075bdeef93a6a2cf3fa02211e2b7c93d598764c390"
actual_auth_test_sha="$(sha256sum tests/client/test_auth.py 2>/dev/null | cut -d' ' -f1)"
if [ "$actual_auth_test_sha" != "$expected_auth_test_sha" ]; then
  {
    echo "FAIL: tests/client/test_auth.py was modified (forbidden)."
    echo "Only fix the underlying bug; do not weaken or remove existing tests."
  } >> "$out"
  echo 0 > /logs/verifier/reward.txt
  exit 0
fi

echo "--- hidden test ---" >> "$out"
python -m pytest -q /tests/hidden_test_auth_state.py >> "$out" 2>&1
hidden_status=$?

echo "--- full public suite (excluding known flaky test, see HTTPX_BASELINE.md) ---" >> "$out"
python -m pytest -q --deselect 'tests/test_timeouts.py::test_write_timeout[trio]' >> "$out" 2>&1
public_status=$?

if [ "$hidden_status" -eq 0 ] && [ "$public_status" -eq 0 ]; then
  echo 1 > /logs/verifier/reward.txt
else
  echo 0 > /logs/verifier/reward.txt
fi
