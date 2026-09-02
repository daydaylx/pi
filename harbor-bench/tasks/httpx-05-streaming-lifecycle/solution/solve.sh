#!/bin/bash
set -euo pipefail
cd /app
python3 - <<'PYEOF'
path = "httpx/_models.py"
src = open(path).read()
old = '''        if not isinstance(self.stream, SyncByteStream):
            raise RuntimeError("Attempted to call a sync close on an async stream.")

        self.is_closed = True
        with request_context(request=self._request):
            self.stream.close()'''
new = '''        if not isinstance(self.stream, SyncByteStream):
            raise RuntimeError("Attempted to call a sync close on an async stream.")

        if not self.is_closed:
            self.is_closed = True
            with request_context(request=self._request):
                self.stream.close()'''
assert src.count(old) == 1, "expected mutated pattern not found"
open(path, "w").write(src.replace(old, new))
PYEOF
git add -A
git commit -q -m "fix: restore idempotency guard on Response.close()"
