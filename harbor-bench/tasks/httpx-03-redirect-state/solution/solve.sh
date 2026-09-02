#!/bin/bash
set -euo pipefail
cd /app
sed -i 's/if not _same_origin(url, request\.url) and method == request\.method:/if not _same_origin(url, request.url):/' httpx/_client.py
git add -A
git commit -q -m "fix: strip Authorization/update Host on every cross-origin redirect, not just method-preserving ones"
