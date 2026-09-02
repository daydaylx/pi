FROM httpx-snapshot:b5addb64

WORKDIR /app

# Controlled mutation (Benchmark v3 Teil C, HTTPX Task 5): removes the
# idempotency guard from `Response.close()` in httpx/_models.py (the
# equivalent async `aclose()` is left untouched, deliberately -- this task
# is about lifecycle/double-release, not sync/async parity, which is
# already Task 2's domain). The guard is not defensive dead code: normal
# usage of `with client.stream(...) as response: response.read()` already
# triggers TWO close attempts in correct httpx (auto-close when the byte
# iterator is exhausted, then the context manager's own `finally:
# response.close()`) -- the guard is what makes that safe. Removing it
# means the underlying stream's `.close()` gets invoked twice on every
# ordinary streaming request that's fully consumed inside a `with` block.
# Verified empirically: still 1416 passed / 1 skipped / 1 known-flaky-
# failed against httpx's own full public test suite -- none of its tests
# use a stream whose `.close()` isn't a silent no-op, so the double call
# has no assertable effect on them. Reproduced manually with a
# close-call-counting custom SyncByteStream: close_count == 2 instead of 1.
RUN python3 - <<'PYEOF'
path = "httpx/_models.py"
src = open(path).read()
old = '''        if not isinstance(self.stream, SyncByteStream):
            raise RuntimeError("Attempted to call a sync close on an async stream.")

        if not self.is_closed:
            self.is_closed = True
            with request_context(request=self._request):
                self.stream.close()'''
new = '''        if not isinstance(self.stream, SyncByteStream):
            raise RuntimeError("Attempted to call a sync close on an async stream.")

        self.is_closed = True
        with request_context(request=self._request):
            self.stream.close()'''
assert src.count(old) == 1, "expected pattern not found"
open(path, "w").write(src.replace(old, new))
PYEOF

# Re-baseline: fold the mutation into the one existing commit so there is
# nothing earlier to `git diff`/`git log -p` against.
RUN git add -A && git commit -q -m "baseline (pre-agent)" --amend
