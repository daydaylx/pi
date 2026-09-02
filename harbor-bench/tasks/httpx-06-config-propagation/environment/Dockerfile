FROM httpx-snapshot:b5addb64

WORKDIR /app

# Controlled mutation (Benchmark v3 Teil C, HTTPX Task 6): drops
# `http2=http2` from the `HTTPTransport(...)`/`AsyncHTTPTransport(...)`
# call inside `_init_proxy_transport` (both the sync `Client` and async
# `AsyncClient` copies of the method in httpx/_client.py), while leaving
# `_init_transport` (the default, non-proxy path -- a similar, nearby,
# nearly-identical function acting as a distractor) untouched. A client
# configured with `http2=True` keeps using HTTP/2 for direct requests but
# silently falls back to HTTP/1.1-only for anything routed through a
# proxy mount. Verified empirically: still 1416 passed / 1 skipped / 1
# known-flaky-failed against httpx's own full public test suite -- no
# existing test combines `http2=True` with a `proxy=`/`mounts=`
# configuration. Reproduced manually via httpcore pool introspection
# (`transport._pool._http2`): direct transport True, proxy transport
# False, same client.
RUN python3 - <<'PYEOF'
path = "httpx/_client.py"
src = open(path).read()

sync_old = '''    def _init_proxy_transport(
        self,
        proxy: Proxy,
        verify: ssl.SSLContext | str | bool = True,
        cert: CertTypes | None = None,
        trust_env: bool = True,
        http1: bool = True,
        http2: bool = False,
        limits: Limits = DEFAULT_LIMITS,
    ) -> BaseTransport:
        return HTTPTransport(
            verify=verify,
            cert=cert,
            trust_env=trust_env,
            http1=http1,
            http2=http2,
            limits=limits,
            proxy=proxy,
        )'''
sync_new = sync_old.replace("            http2=http2,\n", "", 1)
assert src.count(sync_old) == 1, "sync pattern not found"
src = src.replace(sync_old, sync_new)

async_old = '''        return AsyncHTTPTransport(
            verify=verify,
            cert=cert,
            trust_env=trust_env,
            http1=http1,
            http2=http2,
            limits=limits,
            proxy=proxy,
        )'''
async_new = async_old.replace("            http2=http2,\n", "", 1)
assert src.count(async_old) == 1, "async pattern not found"
src = src.replace(async_old, async_new)

open(path, "w").write(src)
PYEOF

# Re-baseline: fold the mutation into the one existing commit so there is
# nothing earlier to `git diff`/`git log -p` against.
RUN git add -A && git commit -q -m "baseline (pre-agent)" --amend
