#!/bin/bash
set -euo pipefail
cd /app
echo "agent was here" >> notes.txt
git add notes.txt
git commit -q -m "append agent was here"
