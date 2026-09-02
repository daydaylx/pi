FROM python:3.12.3-slim-bookworm

# System deps: git for the canonical benchmark git-baseline (Gate A2, applies
# harness-neutrally to Pi and Codex alike -- see agents/pi_harness/agent.py
# and ENVIRONMENT_LOCK.md). build-essential covers any dependency without a
# prebuilt manylinux wheel for this exact base image.
RUN apt-get update && apt-get install -y --no-install-recommends git build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Pristine source at the pinned commit (HTTPX_BASELINE.md), extracted via
# `git archive` on the host -- no network fetch during this build, no local
# venv/cache cruft carried in.
COPY httpx-src/ /app/
COPY baseline-freeze.txt /tmp/baseline-freeze.txt

# baseline-freeze.txt's httpx entry is `-e git+https://github.com/encode/httpx...`
# (pip freeze's own rendering of an editable install) -- installing that
# literally would re-clone httpx from the network during image build.
# Filtered out; httpx itself is installed from the local COPY above instead.
# hatchling/hatch-fancy-pypi-readme: httpx's own [build-system].requires
# (pyproject.toml) -- installed up front so the editable install below can
# run with --no-build-isolation instead of creating a second, separate
# isolated build env (whose own network fetch failed once with a transient
# DNS error during initial development of this Dockerfile).
RUN grep -v '^-e ' /tmp/baseline-freeze.txt > /tmp/deps.txt \
    && pip install --no-cache-dir -r /tmp/deps.txt hatchling hatch-fancy-pypi-readme editables \
    && pip install --no-cache-dir --no-deps --no-build-isolation -e /app

# --- pi-vs-codex benchmark: canonical git baseline (Benchmark v3 Gate A2) ---
# Same block as every other task's Dockerfile: harness-neutral, applies to
# Pi and Codex alike, baked in at image-build time.
RUN git config --system user.email "benchmark@harbor.local" \
    && git config --system user.name "Harbor Benchmark" \
    && git config --system --add safe.directory '*' \
    && git init -q && git add -A \
    && git commit -q -m "baseline (pre-agent): encode/httpx @ b5addb64f0161ff6bfe94c124ef76f6a1fba5254" --allow-empty
