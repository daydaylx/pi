FROM httpx-snapshot:b5addb64

WORKDIR /app

# Controlled mutation (Benchmark v3 Teil C, HTTPX Task 1): a single-character
# operator swap in the client/request query-param merge condition.
# `if params or self.params:` -> `if params and self.params:` -- when a
# client has default params configured but the specific request call passes
# none of its own, the merge is skipped entirely and the client's default
# params are silently dropped (verified empirically: still 1416 passed / 1
# skipped / 1 known-flaky-failed against httpx's own full public test suite
# -- this mutation is invisible to it, by design, see HTTPX_BASELINE.md for
# the one known flaky test).
RUN sed -i 's/if params or self\.params:/if params and self.params:/' httpx/_client.py

# Re-baseline: the agent's git history must start from the MUTATED (buggy)
# state, not show a diff against the pristine snapshot -- otherwise `git
# diff HEAD~1`/`git log -p` would hand the agent the mutation directly.
# --amend folds it into the one existing commit, so there is still exactly
# one commit total with nothing earlier to diff against.
RUN git add -A && git commit -q -m "baseline (pre-agent)" --amend
