FROM node:22.23.2-bookworm-slim

WORKDIR /app

# typescript-language-server: needed so the LSP step in instruction.md has a
# real server to talk to (Pi's built-in "typescript" LSP profile spawns
# `typescript-language-server --stdio` off $PATH -- see
# extensions/lsp/server-profiles.ts). Global install keeps the fixture free
# of its own node_modules/package-lock.
RUN npm install -g typescript-language-server@5.1.2 typescript@5.9.3

COPY fixture/ /app/

# --- pi-vs-codex benchmark: canonical git baseline (Benchmark v3 Gate A2) ---
# Same block as the other tasks' Dockerfiles (see tasks/02-local-bug):
# harness-neutral, applies to Pi and Codex alike.
RUN apt-get update && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*
RUN git config --system user.email "benchmark@harbor.local" \
    && git config --system user.name "Harbor Benchmark" \
    && git config --system --add safe.directory '*' \
    && git init -q && git add -A \
    && git commit -q -m "baseline (pre-agent)" --allow-empty
