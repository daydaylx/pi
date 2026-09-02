#!/bin/bash
set -euo pipefail
cd /app
python3 - <<'PYEOF'
path = "httpx/_client.py"
lines = open(path).read().split("\n")
count = 0
for i, line in enumerate(lines):
    if "if len(history) >= self.max_redirects:" in line:
        count += 1
        lines[i] = line.replace(">=", ">")
assert count == 1, f"expected exactly 1 occurrence of the mutated guard, found {count}"
open(path, "w").write("\n".join(lines))
PYEOF
git add -A
git commit -q -m "fix: align async redirect-limit check with sync (off-by-one)"
