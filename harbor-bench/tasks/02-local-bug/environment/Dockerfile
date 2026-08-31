FROM node:22.23.2-bookworm-slim

WORKDIR /app

# jiti: TypeScript/ESM loader the fixture's own test driver needs at
# runtime (searches upward for npm/node_modules/jiti from its own
# directory, see run-fixture-test.mjs). Pinned to the version pinned in
# the real repo's npm/node_modules/jiti for consistency.
RUN mkdir -p npm/node_modules && cd npm && npm init -y >/dev/null 2>&1 && \
    npm install --no-save jiti@2.7.0 >/dev/null 2>&1

COPY benchmark-fixture/ /app/benchmark-fixture/
