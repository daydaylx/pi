FROM httpx-snapshot:b5addb64

WORKDIR /app

# Controlled mutation (Benchmark v3 Teil C, HTTPX Task 4): reorders
# `_build_request_auth` in httpx/_client.py so URL-embedded credentials are
# checked and returned FIRST, before resolving any explicitly configured
# `auth` (client-level or per-request). No existing test combines
# URL-embedded credentials with an explicit `auth=` at the same time
# (verified empirically: still 1416 passed / 1 skipped / 1 known-flaky-
# failed against httpx's own full public test suite). Reproduced manually:
# a client configured with `auth=("explicit-user", "explicit-pass")`
# silently sends URL-embedded `url-user:url-pass` credentials instead when
# the request URL happens to carry them.
RUN python3 - <<'PYEOF'
path = "httpx/_client.py"
src = open(path).read()
old = '''        auth = (
            self._auth if isinstance(auth, UseClientDefault) else self._build_auth(auth)
        )

        if auth is not None:
            return auth

        username, password = request.url.username, request.url.password
        if username or password:
            return BasicAuth(username=username, password=password)

        return Auth()'''
new = '''        username, password = request.url.username, request.url.password
        if username or password:
            return BasicAuth(username=username, password=password)

        auth = (
            self._auth if isinstance(auth, UseClientDefault) else self._build_auth(auth)
        )

        if auth is not None:
            return auth

        return Auth()'''
assert src.count(old) == 1, "expected pattern not found"
open(path, "w").write(src.replace(old, new))
PYEOF

# Re-baseline: fold the mutation into the one existing commit so there is
# nothing earlier to `git diff`/`git log -p` against.
RUN git add -A && git commit -q -m "baseline (pre-agent)" --amend
