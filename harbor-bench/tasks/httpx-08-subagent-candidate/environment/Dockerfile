FROM httpx-snapshot:b5addb64

WORKDIR /app

# Controlled mutation (Benchmark v3 Teil C, HTTPX Task 8): reverses the
# dict-update order in BaseClient.__init__ (both sync Client and
# AsyncClient) that assembles self._mounts from an explicit `mounts=`
# argument and from the `proxy=` shorthand (which always produces a
# catch-all "all://" pattern via _get_proxy_map). Explicit `mounts=`
# entries are now applied FIRST and the proxy-derived catch-all is
# layered on top, so on a key collision the proxy-derived entry silently
# wins instead of the explicit override. No existing test combines
# `proxy=` and `mounts=` in the same Client()/AsyncClient() call (verified
# empirically: still 1416 passed / 1 skipped / 1 known-flaky-failed
# against httpx's own full public test suite). Reproduced manually for
# both sync and async: `Client(proxy=<global>, mounts={"all://":
# <dedicated transport>})` resolves every URL to the global proxy
# transport, never the dedicated one.
RUN python3 - <<'PYEOF'
path = "httpx/_client.py"
src = open(path).read()

sync_old = '''self._mounts: dict[URLPattern, BaseTransport | None] = {
            URLPattern(key): None
            if proxy is None
            else self._init_proxy_transport(
                proxy,
                verify=verify,
                cert=cert,
                trust_env=trust_env,
                http1=http1,
                http2=http2,
                limits=limits,
            )
            for key, proxy in proxy_map.items()
        }
        if mounts is not None:
            self._mounts.update(
                {URLPattern(key): transport for key, transport in mounts.items()}
            )

        self._mounts = dict(sorted(self._mounts.items()))'''
sync_new = '''self._mounts: dict[URLPattern, BaseTransport | None] = (
            {}
            if mounts is None
            else {URLPattern(key): transport for key, transport in mounts.items()}
        )
        self._mounts.update(
            {
                URLPattern(key): None
                if proxy is None
                else self._init_proxy_transport(
                    proxy,
                    verify=verify,
                    cert=cert,
                    trust_env=trust_env,
                    http1=http1,
                    http2=http2,
                    limits=limits,
                )
                for key, proxy in proxy_map.items()
            }
        )

        self._mounts = dict(sorted(self._mounts.items()))'''
assert src.count(sync_old) == 1, "sync pattern not found"
src = src.replace(sync_old, sync_new)

async_old = ('self._mounts: dict[URLPattern, AsyncBaseTransport | None] = {\n'
    '            URLPattern(key): None\n'
    '            if proxy is None\n'
    '            else self._init_proxy_transport(\n'
    '                proxy,\n'
    '                verify=verify,\n'
    '                cert=cert,\n'
    '                trust_env=trust_env,\n'
    '                http1=http1,\n'
    '                http2=http2,\n'
    '                limits=limits,\n'
    '            )\n'
    '            for key, proxy in proxy_map.items()\n'
    '        }\n'
    '        if mounts is not None:\n'
    '            self._mounts.update(\n'
    '                {URLPattern(key): transport for key, transport in mounts.items()}\n'
    '            )\n'
    '        self._mounts = dict(sorted(self._mounts.items()))')
async_new = (
    'self._mounts: dict[URLPattern, AsyncBaseTransport | None] = (\n'
    '            {}\n'
    '            if mounts is None\n'
    '            else {URLPattern(key): transport for key, transport in mounts.items()}\n'
    '        )\n'
    '        self._mounts.update(\n'
    '            {\n'
    '                URLPattern(key): None\n'
    '                if proxy is None\n'
    '                else self._init_proxy_transport(\n'
    '                    proxy,\n'
    '                    verify=verify,\n'
    '                    cert=cert,\n'
    '                    trust_env=trust_env,\n'
    '                    http1=http1,\n'
    '                    http2=http2,\n'
    '                    limits=limits,\n'
    '                )\n'
    '                for key, proxy in proxy_map.items()\n'
    '            }\n'
    '        )\n'
    '        self._mounts = dict(sorted(self._mounts.items()))'
)
assert src.count(async_old) == 1, "async pattern not found"
src = src.replace(async_old, async_new)

open(path, "w").write(src)
PYEOF

# Re-baseline: fold the mutation into the one existing commit so there is
# nothing earlier to `git diff`/`git log -p` against.
RUN git add -A && git commit -q -m "baseline (pre-agent)" --amend
