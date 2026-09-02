#!/bin/bash
set -euo pipefail
cd /app
sed -i 's/if params and self\.params:/if params or self.params:/' httpx/_client.py
git add -A
git commit -q -m "fix: restore correct client/request query-param merge condition"
