#!/bin/bash
set -euo pipefail
cd /app
python3 - <<'PYEOF'
path = "httpx/_client.py"
src = open(path).read()

sync_broken = '''    def _init_proxy_transport(
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
            limits=limits,
            proxy=proxy,
        )'''
sync_fixed = '''    def _init_proxy_transport(
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
assert src.count(sync_broken) == 1, "sync mutated pattern not found"
src = src.replace(sync_broken, sync_fixed)

async_broken = '''        return AsyncHTTPTransport(
            verify=verify,
            cert=cert,
            trust_env=trust_env,
            http1=http1,
            limits=limits,
            proxy=proxy,
        )'''
async_fixed = '''        return AsyncHTTPTransport(
            verify=verify,
            cert=cert,
            trust_env=trust_env,
            http1=http1,
            http2=http2,
            limits=limits,
            proxy=proxy,
        )'''
assert src.count(async_broken) == 1, "async mutated pattern not found"
src = src.replace(async_broken, async_fixed)

open(path, "w").write(src)
PYEOF
git add -A
git commit -q -m "fix: propagate http2 setting to proxy-mounted transports (sync + async)"
