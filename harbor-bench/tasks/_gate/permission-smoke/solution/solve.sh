#!/bin/bash
set -euo pipefail
cd /app
sed -i 's/return a - b;/return a + b;/' calc.mjs
rm -f scratch.tmp
git add -A
git commit -q -m "fix add(), remove scratch.tmp"
