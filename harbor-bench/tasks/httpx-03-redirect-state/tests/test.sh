#!/bin/bash
# Verifies HTTPX Task 3 (Redirect State Bug). Same two-check pattern as
# Task 1/2: hidden test for the direct symptom, full public suite for
# regressions (see tasks/httpx-01-deep-diagnosis/tests/test.sh).
set -uo pipefail

cd /app || {
  echo "FAIL: /app missing" > /logs/verifier/test-stdout.txt
  echo 0 > /logs/verifier/reward.txt
  exit 0
}

out="/logs/verifier/test-stdout.txt"
: > "$out"

expected_redirects_test_sha="6f33382abd2ecff7d92e0842a2540863d00e28c658fe7813e7d76f70aa5d99dd"
actual_redirects_test_sha="$(sha256sum tests/client/test_redirects.py 2>/dev/null | cut -d' ' -f1)"
if [ "$actual_redirects_test_sha" != "$expected_redirects_test_sha" ]; then
  {
    echo "FAIL: tests/client/test_redirects.py was modified (forbidden)."
    echo "Only fix the underlying bug; do not weaken or remove existing tests."
  } >> "$out"
  echo 0 > /logs/verifier/reward.txt
  exit 0
fi

echo "--- hidden test ---" >> "$out"
python -m pytest -q /tests/hidden_test_redirect_state.py >> "$out" 2>&1
hidden_status=$?

echo "--- full public suite (excluding known flaky test, see HTTPX_BASELINE.md) ---" >> "$out"
python -m pytest -q --deselect 'tests/test_timeouts.py::test_write_timeout[trio]' >> "$out" 2>&1
public_status=$?

if [ "$hidden_status" -eq 0 ] && [ "$public_status" -eq 0 ]; then
  echo 1 > /logs/verifier/reward.txt
else
  echo 0 > /logs/verifier/reward.txt
fi
