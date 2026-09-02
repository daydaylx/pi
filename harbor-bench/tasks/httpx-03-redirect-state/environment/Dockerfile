FROM httpx-snapshot:b5addb64

WORKDIR /app

# Controlled mutation (Benchmark v3 Teil C, HTTPX Task 3): the cross-origin
# header-cleanup block in `_redirect_headers` (Authorization stripping +
# Host header update) is gated on an extra `and method == request.method`
# that has no business being there. Every existing cross-domain-auth test
# happens to use GET-to-GET redirects (method unchanged either way), so
# this extra condition is always true for them and the mutation is
# invisible -- it only manifests when a redirect ALSO changes the method
# (e.g. a 303 turning POST into GET) while crossing origins, a combination
# no existing public test exercises (verified empirically: still 1416
# passed / 1 skipped / 1 known-flaky-failed against httpx's own full
# public test suite). Reproduced manually: a cross-origin POST redirected
# via 303 leaks the original Authorization header to the new host and
# keeps the old Host header.
RUN sed -i 's/if not _same_origin(url, request\.url):/if not _same_origin(url, request.url) and method == request.method:/' httpx/_client.py

# Re-baseline: fold the mutation into the one existing commit so there is
# nothing earlier to `git diff`/`git log -p` against.
RUN git add -A && git commit -q -m "baseline (pre-agent)" --amend
