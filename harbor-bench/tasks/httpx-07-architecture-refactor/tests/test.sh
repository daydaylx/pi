#!/bin/bash
# Verifies HTTPX Task 7 (Architecture Refactor). Three checks, all must
# pass: (1) tests/ untouched, (2) structural deduplication actually
# happened (not just behavioral tests staying green -- an unmodified
# baseline already passes those), (3) full public suite still green.
set -uo pipefail

cd /app || {
  echo "FAIL: /app missing" > /logs/verifier/test-stdout.txt
  echo 0 > /logs/verifier/reward.txt
  exit 0
}

out="/logs/verifier/test-stdout.txt"
: > "$out"

if ! git diff --quiet HEAD -- tests/; then
  {
    echo "FAIL: files under tests/ were modified (forbidden)."
    echo "Refactor httpx/ only; the test suite must pass unmodified."
    git diff --stat HEAD -- tests/
  } >> "$out"
  echo 0 > /logs/verifier/reward.txt
  exit 0
fi

echo "--- structural check: transport-kwargs duplication ---" >> "$out"
python3 - >> "$out" 2>&1 <<'PYEOF'
import sys

BASELINE_COUNT = 6  # verified against the pristine, unmodified file
PATTERN = (
    "verify=verify,\n"
    "            cert=cert,\n"
    "            trust_env=trust_env,\n"
    "            http1=http1,\n"
    "            http2=http2,\n"
    "            limits=limits,"
)

src = open("httpx/_client.py").read()
count = src.count(PATTERN)
print(f"literal transport-kwargs block occurrences: {count} (baseline: {BASELINE_COUNT})")
if count >= BASELINE_COUNT:
    print("FAIL: no structural reduction in duplication detected.")
    sys.exit(1)
print("PASS: duplication reduced.")
PYEOF
structural_status=$?

echo "--- full public suite (excluding known flaky test, see HTTPX_BASELINE.md) ---" >> "$out"
python -m pytest -q --deselect 'tests/test_timeouts.py::test_write_timeout[trio]' >> "$out" 2>&1
public_status=$?

echo "--- lint/type checks ---" >> "$out"
ruff check httpx >> "$out" 2>&1
lint_status=$?
mypy httpx >> "$out" 2>&1
mypy_status=$?

if [ "$structural_status" -eq 0 ] && [ "$public_status" -eq 0 ] && [ "$lint_status" -eq 0 ] && [ "$mypy_status" -eq 0 ]; then
  echo 1 > /logs/verifier/reward.txt
else
  echo 0 > /logs/verifier/reward.txt
fi
