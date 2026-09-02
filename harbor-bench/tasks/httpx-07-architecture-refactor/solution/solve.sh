#!/bin/bash
set -euo pipefail
cd /app
python3 - <<'PYEOF'
path = "httpx/_client.py"
src = open(path).read()

anchor = "    def _build_request_auth(\n"
assert src.count(anchor) == 1
helper = '''    @staticmethod
    def _transport_kwargs(
        verify: ssl.SSLContext | str | bool,
        cert: CertTypes | None,
        trust_env: bool,
        http1: bool,
        http2: bool,
        limits: Limits,
    ) -> dict[str, typing.Any]:
        """
        Shared keyword-argument construction for HTTPTransport/AsyncHTTPTransport,
        used by _init_transport/_init_proxy_transport on both Client and AsyncClient.
        """
        return {
            "verify": verify,
            "cert": cert,
            "trust_env": trust_env,
            "http1": http1,
            "http2": http2,
            "limits": limits,
        }

'''
src = src.replace(anchor, helper + anchor, 1)

old = '''        return HTTPTransport(
            verify=verify,
            cert=cert,
            trust_env=trust_env,
            http1=http1,
            http2=http2,
            limits=limits,
        )

    def _init_proxy_transport(
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
new = '''        return HTTPTransport(
            **self._transport_kwargs(verify, cert, trust_env, http1, http2, limits)
        )

    def _init_proxy_transport(
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
            **self._transport_kwargs(verify, cert, trust_env, http1, http2, limits),
            proxy=proxy,
        )'''
assert src.count(old) == 1, "sync pattern not found"
src = src.replace(old, new)

old_async = '''        return AsyncHTTPTransport(
            verify=verify,
            cert=cert,
            trust_env=trust_env,
            http1=http1,
            http2=http2,
            limits=limits,
        )

    def _init_proxy_transport(
        self,
        proxy: Proxy,
        verify: ssl.SSLContext | str | bool = True,
        cert: CertTypes | None = None,
        trust_env: bool = True,
        http1: bool = True,
        http2: bool = False,
        limits: Limits = DEFAULT_LIMITS,
    ) -> AsyncBaseTransport:
        return AsyncHTTPTransport(
            verify=verify,
            cert=cert,
            trust_env=trust_env,
            http1=http1,
            http2=http2,
            limits=limits,
            proxy=proxy,
        )'''
new_async = '''        return AsyncHTTPTransport(
            **self._transport_kwargs(verify, cert, trust_env, http1, http2, limits)
        )

    def _init_proxy_transport(
        self,
        proxy: Proxy,
        verify: ssl.SSLContext | str | bool = True,
        cert: CertTypes | None = None,
        trust_env: bool = True,
        http1: bool = True,
        http2: bool = False,
        limits: Limits = DEFAULT_LIMITS,
    ) -> AsyncBaseTransport:
        return AsyncHTTPTransport(
            **self._transport_kwargs(verify, cert, trust_env, http1, http2, limits),
            proxy=proxy,
        )'''
assert src.count(old_async) == 1, "async pattern not found"
src = src.replace(old_async, new_async)

open(path, "w").write(src)
PYEOF
git add -A
git commit -q -m "refactor: share transport-kwargs construction between sync/async, direct/proxy"
