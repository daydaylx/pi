#!/bin/bash
set -euo pipefail
cd /app
python3 - <<'PYEOF'
path = "httpx/_client.py"
src = open(path).read()

sync_broken = '''self._mounts: dict[URLPattern, BaseTransport | None] = (
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
sync_fixed = '''self._mounts: dict[URLPattern, BaseTransport | None] = {
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
assert src.count(sync_broken) == 1, "sync mutated pattern not found"
src = src.replace(sync_broken, sync_fixed)

async_broken = (
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
async_fixed = (
    'self._mounts: dict[URLPattern, AsyncBaseTransport | None] = {\n'
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
    '        self._mounts = dict(sorted(self._mounts.items()))'
)
assert src.count(async_broken) == 1, "async mutated pattern not found"
src = src.replace(async_broken, async_fixed)

open(path, "w").write(src)
PYEOF
git add -A
git commit -q -m "fix: explicit mounts= entries take precedence over proxy=-derived catch-all (sync + async)"
