#!/bin/bash
set -euo pipefail
cd /app
python3 - <<'PYEOF'
path = "httpx/_client.py"
src = open(path).read()
old = '''        username, password = request.url.username, request.url.password
        if username or password:
            return BasicAuth(username=username, password=password)

        auth = (
            self._auth if isinstance(auth, UseClientDefault) else self._build_auth(auth)
        )

        if auth is not None:
            return auth

        return Auth()'''
new = '''        auth = (
            self._auth if isinstance(auth, UseClientDefault) else self._build_auth(auth)
        )

        if auth is not None:
            return auth

        username, password = request.url.username, request.url.password
        if username or password:
            return BasicAuth(username=username, password=password)

        return Auth()'''
assert src.count(old) == 1, "expected mutated pattern not found"
open(path, "w").write(src.replace(old, new))
PYEOF
git add -A
git commit -q -m "fix: explicit auth takes precedence over URL-embedded credentials"
