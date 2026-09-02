FROM ubuntu:24.04

# Install or copy over any environment dependencies here.

WORKDIR /app

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