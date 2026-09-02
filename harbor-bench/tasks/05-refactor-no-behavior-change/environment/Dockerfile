FROM node:22.23.2-bookworm-slim

WORKDIR /app

# jiti: TypeScript/ESM loader the fixture's own test driver needs at
# runtime (searches upward for npm/node_modules/jiti from its own
# directory, see run-fixture-test.mjs). Pinned to the version pinned in
# the real repo's npm/node_modules/jiti for consistency.
RUN mkdir -p npm/node_modules && cd npm && npm init -y >/dev/null 2>&1 && \
    npm install --no-save jiti@2.7.0 >/dev/null 2>&1

COPY benchmark-fixture/ /app/benchmark-fixture/

# --- pi-vs-codex benchmark: canonical git baseline (Benchmark v3 Gate A2) ---
# Harness-neutral: baked into the image, so it applies identically whether
# the trial runs Pi or Codex (Harbor's built-in Codex adapter is not our
# code -- the Dockerfile is the only place that reaches both). `--system`
# (not `--global`) so it applies regardless of which user later runs
# git inside the container.
RUN apt-get update && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*
RUN git config --system user.email "benchmark@harbor.local" \
    && git config --system user.name "Harbor Benchmark" \
    && git config --system --add safe.directory '*' \
    && git init -q && git add -A \
    && git commit -q -m "baseline (pre-agent)" --allow-empty
