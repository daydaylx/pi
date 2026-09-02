#!/bin/bash
# Verifies HTTPX Task 5 (Streaming/Lifecycle Verification Trap). Same
# two-check pattern as Tasks 1-4: hidden test for the direct symptom, full
# public suite for regressions (see tasks/httpx-01-deep-diagnosis/tests/test.sh).
set -uo pipefail

cd /app || {
  echo "FAIL: /app missing" > /logs/verifier/test-stdout.txt
  echo 0 > /logs/verifier/reward.txt
  exit 0
}

out="/logs/verifier/test-stdout.txt"
: > "$out"

expected_responses_test_sha="8bc046610e0faa1c4531c4d2006bfc87c5ba2aaecf82b135413e64eb86712de3"
actual_responses_test_sha="$(sha256sum tests/models/test_responses.py 2>/dev/null | cut -d' ' -f1)"
if [ "$actual_responses_test_sha" != "$expected_responses_test_sha" ]; then
  {
    echo "FAIL: tests/models/test_responses.py was modified (forbidden)."
    echo "Only fix the underlying bug; do not weaken or remove existing tests."
  } >> "$out"
  echo 0 > /logs/verifier/reward.txt
  exit 0
fi

echo "--- hidden test ---" >> "$out"
python -m pytest -q /tests/hidden_test_streaming_lifecycle.py >> "$out" 2>&1
hidden_status=$?

echo "--- full public suite (excluding known flaky test, see HTTPX_BASELINE.md) ---" >> "$out"
python -m pytest -q --deselect 'tests/test_timeouts.py::test_write_timeout[trio]' >> "$out" 2>&1
public_status=$?

if [ "$hidden_status" -eq 0 ] && [ "$public_status" -eq 0 ]; then
  echo 1 > /logs/verifier/reward.txt
else
  echo 0 > /logs/verifier/reward.txt
fi
