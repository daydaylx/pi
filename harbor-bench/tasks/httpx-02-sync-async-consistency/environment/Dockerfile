FROM httpx-snapshot:b5addb64

WORKDIR /app

# Controlled mutation (Benchmark v3 Teil C, HTTPX Task 2): the sync and
# async `_send_handling_redirects` methods in httpx/_client.py both start
# with an identical `if len(history) > self.max_redirects:` guard -- this
# mutates ONLY the second (async) occurrence to `>=`, an off-by-one that
# makes AsyncClient reject a redirect chain of exactly `max_redirects`
# length that Client accepts (verified empirically: still 1416 passed / 1
# skipped / 1 known-flaky-failed against httpx's own full public test
# suite -- no existing test checks the async client at the exact boundary,
# only sync (test_multiple_redirects) and over-the-limit for both).
RUN python3 - <<'PYEOF'
path = "httpx/_client.py"
lines = open(path).read().split("\n")
count = 0
for i, line in enumerate(lines):
    if "if len(history) > self.max_redirects:" in line:
        count += 1
        if count == 2:
            lines[i] = line.replace(">", ">=")
assert count == 2, f"expected 2 occurrences, found {count}"
open(path, "w").write("\n".join(lines))
PYEOF

# Re-baseline: fold the mutation into the one existing commit so there is
# nothing earlier to `git diff`/`git log -p` against.
RUN git add -A && git commit -q -m "baseline (pre-agent)" --amend
