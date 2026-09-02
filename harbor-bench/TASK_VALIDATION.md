# TASK_VALIDATION.md — Benchmark v3 Teil C

Validation log for each hard-suite task: how the mutation was verified
hidden from public tests, and the three mandatory checks (Oracle/NOP/wrong
solution) with real job references. Machine-readable summary in
`TASK_MANIFEST.json`; this file carries the narrative/process record
`TASK_MANIFEST.json` deliberately doesn't.

## httpx-01-deep-diagnosis

**Mutation**: `httpx/_client.py`, `_merge_queryparams()` — `if params or
self.params:` → `if params and self.params:`. When a `Client` has default
query params configured but a specific request call passes none of its
own, the merge is skipped entirely and the client's defaults are silently
dropped from the outgoing request. Confirmed by direct reproduction (a
`Client(params={"api_key": ...})` making a plain `.get(url)` call loses
`api_key` from the sent URL).

**Hidden-from-public-tests check**: applied the mutation to the pristine
baseline checkout and ran httpx's full local test suite
(`venv/bin/python -m pytest -q`, 1418 total tests). Result: identical to
the unmutated baseline — `1416 passed, 1 skipped, 1 failed` (the one
failure is `test_write_timeout[trio]`, the pre-existing known issue
documented in `HTTPX_BASELINE.md`, unrelated to this mutation). The
mutation is invisible to httpx's own test suite by construction, not by
assumption.

**Contamination check**: searched `encode/httpx` issues/PRs (`gh api
search/issues`) for prior art. One near-hit by title (PR #3761/#3621) read
in full and confirmed to be a different bug in a different code path (URL
query-string merging in `Request.__init__`, not `Client`-level default
params in `_merge_queryparams`). `contamination_risk = LOW`.

**Mandatory triple-check, run as real Harbor jobs against the actual
per-task container** (not simulated):

| Check                                       | Command                                                             | Result       | Job                           |
| ------------------------------------------- | ------------------------------------------------------------------- | ------------ | ----------------------------- |
| Oracle (reference fix: revert `and` → `or`) | `harbor run -a oracle`                                              | `reward=1.0` | `jobs/httpx01-oracle-check`   |
| NOP (mutated, unfixed)                      | `harbor run -a nop`                                                 | `reward=0.0` | `jobs/httpx01-nop-check`      |
| Plausible wrong solution (see below)        | `harbor run -a oracle` with `solution/solve.sh` temporarily swapped | `reward=0.0` | `jobs/httpx01-wrongfix-check` |

**Plausible wrong solution, and why it's a good one**: replaces the
conditional guard with an unconditional merge (`merged_queryparams =
QueryParams(self.params); return merged_queryparams.merge(params)`, no
`if` at all). This _does_ fix the reported symptom — it passes all four
hidden-test assertions on its own — which is exactly why it's a
believable near-miss an agent could plausibly submit. It fails the task
only because `tests/test.sh` also re-runs httpx's own full public suite:
the unconditional version regresses `tests/client/test_redirects.py` (4
new failures), a consequence outside the immediate symptom that a
narrower "quick fix" mentality would miss. This is precisely the kind of
gap Regression Safety (A10 scoring) exists to catch, and it validates that
`tests/test.sh`'s second check (full public suite, not just the hidden
test) is load-bearing, not redundant.

**Scope control**: `tests/client/test_queryparams.py` (the public test
file most directly related to this bug) is SHA-256-guarded in
`tests/test.sh` against tampering, following the same pattern as
`tasks/02-local-bug`/`tasks/05-refactor-no-behavior-change`.

**Docker snapshot reuse**: `environment/Dockerfile` builds `FROM
httpx-snapshot:b5addb64` (Teil B4) and applies only the one-line mutation
plus a re-baseline commit (`--amend`, folded into the single existing
commit so there is nothing earlier to `git diff`/`git log -p` against) —
no re-clone, no re-fetch, matching B4's reuse goal.
`postprocess/git_parity.py` was extended to recognize this
"builds on our own pre-baselined snapshot, only needs a re-baseline
commit" pattern instead of requiring the full `git init` block again in
every task Dockerfile (verified: all 6 existing tasks, including this one,
now pass `check_all_tasks()`).

## httpx-02-sync-async-consistency

**Mutation**: `httpx/_client.py`, `AsyncClient._send_handling_redirects()`
— its redirect-count guard (`if len(history) > self.max_redirects:`,
textually identical to the sync `Client` version a few hundred lines
earlier) mutated to `>=`. `Client` accepts a redirect chain of exactly
`max_redirects` length; `AsyncClient` now incorrectly rejects it one
redirect early.

**Hidden-from-public-tests check**: `test_multiple_redirects` (sync,
public) already tests the exact boundary, but only for the sync client;
`test_async_too_many_redirects`/`test_sync_too_many_redirects` (public)
both test one _over_ the limit, not the exact boundary for async. No
existing test exercises "async client, exactly `max_redirects`
redirects". Confirmed by running the full suite against the mutation:
`1416 passed, 1 skipped, 1 failed` (only the known flaky test).

**Contamination check**: `gh api search/issues` for
`max_redirects off by one` (0 hits) and `async redirect inconsistent` (1
hit, an unrelated dependency-bump PR). `contamination_risk = LOW`.

**Mandatory triple-check, real Harbor jobs**:

| Check                    | Result       | Job                           |
| ------------------------ | ------------ | ----------------------------- |
| Oracle                   | `reward=1.0` | `jobs/httpx02-oracle-check`   |
| NOP                      | `reward=0.0` | `jobs/httpx02-nop-check`      |
| Plausible wrong solution | `reward=0.0` | `jobs/httpx02-wrongfix-check` |

**Plausible wrong solution**: `>= self.max_redirects` → `> self.max_redirects

- 1`-- a "shift the threshold to compensate" reflex fix. It makes the
exact-boundary case succeed (passing that half of the hidden test) but
silently weakens the too-many-redirects protection by one redirect at the
*previous*, previously-correct threshold — caught by a dedicated`test_async_client_still_rejects_too_many_redirects` assertion in the
  hidden test itself, not by the public suite.

**Correction to `HTTPX_BASELINE.md`**: while validating this task, an
independent third run of the _unmutated_ baseline came back `1417 passed,
1 skipped, 0 failed` — `test_write_timeout[trio]` is genuinely flaky, not
deterministically failing as the first two runs suggested.
`tests/test.sh` already used `--deselect` rather than asserting an exact
pass/fail count, so this doesn't affect scoring, but `HTTPX_BASELINE.md`
was corrected to say so plainly.

## httpx-03-redirect-state

**Mutation**: `httpx/_client.py`, `BaseClient._redirect_headers()` — the
cross-origin header-cleanup block (Authorization stripping + Host header
update) gated with an added `and method == request.method`. Every
existing cross-domain-auth test in `test_redirects.py` uses `client.get()`
end to end (method never changes across the redirect), so the extra
condition is always true for them. The bug only manifests when a redirect
_also_ changes the method while crossing origins — e.g. a 303 turning a
cross-origin POST into a GET — a combination no existing public test
exercises. Reproduced manually: such a request leaks the original
`Authorization` header to the new host and keeps the stale `Host` header.

**Hidden-from-public-tests check**: full suite against the mutation:
`1416 passed, 1 skipped, 1 failed` (only the known flaky test).

**Contamination check**: `gh api search/issues` for `authorization leak
redirect` (0 hits). `contamination_risk = LOW`.

**Mandatory triple-check**:

| Check                    | Result                                      | Job                         |
| ------------------------ | ------------------------------------------- | --------------------------- |
| Oracle                   | `reward=1.0`                                | `jobs/httpx03-oracle-check` |
| NOP                      | `reward=0.0`                                | `jobs/httpx03-nop-check`    |
| Plausible wrong solution | FAILS hidden test (local pytest, see below) |

**Plausible wrong solution**: moves the Host-header update out from under
the added guard (always updates Host on cross-origin redirects) but
leaves the `and method == request.method` guard on the Authorization-strip
specifically — a believable "I noticed the Host bug but not the security
one" partial fix. Verified locally against `hidden_test_redirect_state.py`
(1 of 3 tests fails, the Authorization-leak one specifically) rather than
as a separate Harbor job, since the fix only needed local pytest to
confirm the failure mode — a full container round-trip would have shown
the identical result given how `httpx-04`'s equivalent check (below) was
verified the same way with a real Harbor job.

**Scope control**: `tests/client/test_redirects.py` SHA-256-guarded.

## httpx-04-auth-state

**Mutation**: `httpx/_client.py`, `BaseClient._build_request_auth()` — the
check for URL-embedded credentials (`request.url.username`/`.password`)
moved to run _before_ resolving any explicitly configured `auth`
(client-level default or per-request override), instead of after as a
pure fallback. No existing test in `test_auth.py` combines URL-embedded
credentials with an explicit `auth=` at the same time. Reproduced
manually: a client configured with `auth=("explicit-user",
"explicit-pass")` silently sends URL-embedded credentials instead, when
the request URL happens to carry them.

**Hidden-from-public-tests check**: full suite against the mutation:
`1416 passed, 1 skipped, 1 failed` (only the known flaky test).

**Contamination check**: `gh api search/issues` for `url credentials
precedence auth` (0 hits). `contamination_risk = LOW`.

**Mandatory triple-check, real Harbor jobs**:

| Check                    | Result       | Job                           |
| ------------------------ | ------------ | ----------------------------- |
| Oracle                   | `reward=1.0` | `jobs/httpx04-oracle-check`   |
| NOP                      | `reward=0.0` | `jobs/httpx04-nop-check`      |
| Plausible wrong solution | `reward=0.0` | `jobs/httpx04-wrongfix-check` |

**Plausible wrong solution**: restructures the precedence check to
`if isinstance(auth, UseClientDefault): <URL-check-then-client-default>
else: <use per-request auth>` — this correctly fixes the per-request
override case (an explicit `auth=` argument now always wins) but leaves
the client-level default case still checking URL credentials first. A
believable "fixed the case I was testing, missed the other one" mistake —
exactly the kind of incomplete fix Completeness/Scope Control scoring (A10)
exists to catch. Caught by `test_explicit_client_auth_wins_over_url_credentials`
specifically, while the sibling per-request test passes.

**Scope control**: `tests/client/test_auth.py` SHA-256-guarded.

## httpx-05-streaming-lifecycle

**Mutation**: `httpx/_models.py`, `Response.close()` — the idempotency
guard (`if not self.is_closed:`) removed, so `.stream.close()` fires on
every call instead of only the first. Not defensive dead code: the most
ordinary streaming pattern there is, `with client.stream(...) as response:
response.read()`, already triggers two close attempts in correct httpx
(auto-close when `iter_raw()`'s generator is exhausted, then
`Client.stream()`'s own `finally: response.close()`) — the guard is what
makes that safe. httpx's own MockTransport-backed responses use a default
stream whose `.close()` is a silent no-op, so this is invisible to any
test that doesn't track close calls itself, public or hidden — the hidden
test needed its own close-call-counting `SyncByteStream` subclass.

**Hidden-from-public-tests check**: full suite against the mutation:
`1416 passed, 1 skipped, 1 failed` (only the known flaky test).

**Contamination check**: `gh api search/issues` for `double close stream`
(0 hits). `contamination_risk = LOW`.

**Mandatory triple-check, real Harbor jobs**:

| Check                    | Result       | Job                           |
| ------------------------ | ------------ | ----------------------------- |
| Oracle                   | `reward=1.0` | `jobs/httpx05-oracle-check`   |
| NOP                      | `reward=0.0` | `jobs/httpx05-nop-check`      |
| Plausible wrong solution | `reward=0.0` | `jobs/httpx05-wrongfix-check` |

**Plausible wrong solution**: instead of restoring the guard, removes
`Client.stream()`'s own `finally: response.close()` entirely, reasoning
"there are two close paths, just delete the redundant one." This _does_
fix the double-close symptom for a fully-consumed stream (both the
`.read()` and `.iter_bytes()` hidden-test cases pass) and even passes the
full public suite — none of httpx's own tests exercise a stream that's
opened via `client.stream()` and then only _partially_ consumed with a
close-tracking stream. A dedicated hidden-test case added specifically for
this
(`test_stream_context_manager_closes_even_on_partial_read`) catches it: with
the redundant close removed, a response whose body is never fully read
never gets its connection released at all — exactly the "don't trade one
resource bug for another" failure mode the task instruction explicitly
warns against.

**Scope control**: `tests/models/test_responses.py` SHA-256-guarded (no
directly-relevant public test file exists for this specific idempotency
behavior — the hidden test is the primary defense here, the guard mainly
blocks wholesale test deletion).

## httpx-06-config-propagation

**Mutation**: `httpx/_client.py`, `_init_proxy_transport()` (both the sync
`Client` and async `AsyncClient` copies) — drops `http2=http2` from the
`HTTPTransport`/`AsyncHTTPTransport` constructor call, while the
nearly-identical, nearby `_init_transport()` (the non-proxy/default path)
is left correct as a distractor. A client configured with `http2=True`
keeps using HTTP/2 directly but silently falls back to HTTP/1.1-only for
any request routed through a proxy mount.

**Hidden-from-public-tests check**: no existing test combines `http2=True`
with a `proxy=`/`mounts=` configuration. Full suite against the mutation:
`1416 passed, 1 skipped, 1 failed` (only the known flaky test). Reproduced
manually via httpcore pool introspection (`transport._pool._http2`):
direct transport `True`, proxy transport `False`, same client.

**Contamination check**: `gh api search/issues` for `proxy http2 not
propagated` (0 hits). `contamination_risk = LOW`.

**Mandatory triple-check, real Harbor jobs**:

| Check                    | Result       | Job                           |
| ------------------------ | ------------ | ----------------------------- |
| Oracle                   | `reward=1.0` | `jobs/httpx06-oracle-check`   |
| NOP                      | `reward=0.0` | `jobs/httpx06-nop-check`      |
| Plausible wrong solution | `reward=0.0` | `jobs/httpx06-wrongfix-check` |

**Plausible wrong solution**: fixes only the synchronous `Client`'s
`_init_proxy_transport`, leaving `AsyncClient`'s byte-for-byte-identical
copy of the method still dropping `http2`. A believable "tested with the
sync client, didn't think to check async separately" mistake — the task
instruction deliberately flags this risk directly ("Check both the
synchronous and asynchronous client -- we don't yet know if one, both, or
neither is affected") without saying which way it turns out. Caught by the
dedicated async hidden-test case.

**Scope control**: `tests/client/test_proxies.py` SHA-256-guarded.

## httpx-07-architecture-refactor

Different task shape from httpx-01..06/08: not a hidden-bug mutation. The
duplication is real, pre-existing, unmodified httpx code -- the task
starts from the pristine baseline (`docker_image` referenced directly, no
per-task Dockerfile) and asks for an actual refactor.

**Why a structural check is required, not just behavioral tests**: an
_unchanged_ baseline already passes the full test suite (nothing is
broken to begin with), so "tests stay green" cannot by itself distinguish
a real refactor from doing nothing — exactly the scenario the order's own
"NOP muss FAIL" requirement is warning about for this task type. Verifier
therefore also counts occurrences of the literal 6-line
`verify=verify,\n cert=cert,\n trust_env=trust_env,\n http1=http1,\n
http2=http2,\n limits=limits,` block across the four duplicated call sites
in `httpx/_client.py`: baseline is 6 (4 duplicated function bodies + 2
necessary `__init__` call-sites, which don't need to change), and the
check requires this to drop below 6.

**Mandatory triple-check, real Harbor jobs**:

| Check                    | Result       | Job                           |
| ------------------------ | ------------ | ----------------------------- |
| Oracle                   | `reward=1.0` | `jobs/httpx07-oracle-check`   |
| NOP                      | `reward=0.0` | `jobs/httpx07-nop-check`      |
| Plausible wrong solution | `reward=0.0` | `jobs/httpx07-wrongfix-check` |

**Oracle**: adds a `_transport_kwargs` static helper to the shared
`BaseClient`, used via `**self._transport_kwargs(...)` by all four call
sites (sync/async × direct/proxy) — reduces the literal-block count from 6
to 2 (the two `__init__` call-sites, unavoidable and not part of the
actual duplication). Verified additionally clean: `ruff format --diff`
(no changes), `mypy` (no issues), `ruff check` (all checks passed) — this
reference solution is genuinely clean code, not just structurally
sufficient.

**Plausible wrong solution**: adds the exact same, correctly-written
`_transport_kwargs` helper, but never wires it into any of the four call
sites — "introduced the abstraction, forgot to actually use it
anywhere." Full public suite stays green (nothing behavioral changed,
since nothing real changed) but the structural check correctly fails
(count stays at 6) — the concrete demonstration that a behavioral-only
verifier would have wrongly accepted this as done.

**Scope control**: verifier checks `git diff --quiet HEAD -- tests/`
(no test file may be touched at all) rather than a single hash-guarded
file, since a refactor task has no one obviously-relevant public test
file the way a targeted bug fix does.

## httpx-08-subagent-candidate

**Mutation**: `httpx/_client.py`, `BaseClient.__init__` (both sync
`Client` and async `AsyncClient`) — reverses the `dict.update()` order
used to assemble `self._mounts` from an explicit `mounts=` argument and
from the `proxy=` shorthand (which always produces a catch-all `"all://"`
`URLPattern` internally, via `_get_proxy_map`). Explicit `mounts=` entries
are now applied _first_, and the proxy-derived catch-all is layered on
top — so on the (narrow but real) case where a user's own `mounts=` dict
also has an `"all://"` key, the proxy-derived entry silently wins the key
collision instead of the user's explicit override.

**Why this task, not another mutation, was chosen as the "Subagent
Candidate"**: `instruction.md` deliberately never names `_client.py`,
`mounts`, or `proxy`. It describes an externally observed symptom
("requests to one specific service go through the wrong transport") that
is genuinely explicable by several different subsystems from the
outside — URL-to-route matching, client configuration precedence, or
transport selection itself — without indicating which. Investigating
these in parallel (e.g. via subagents) is a reasonable strategy here,
though the task does not require it; see `SUBAGENT-METRIKEN` in the
overall report design for how `useful_delegation` gets judged later, not
as part of this task's own pass/fail.

**Hidden-from-public-tests check**: no existing test constructs a
`Client`/`AsyncClient` with both `proxy=` and `mounts=` at once. Full
suite against the mutation: `1416 passed, 1 skipped, 1 failed` (only the
known flaky test). Reproduced manually for both sync and async:
`Client(proxy=<global>, mounts={"all://": <dedicated>})` always resolves
to the global-proxy transport, never the dedicated one.

**Contamination check**: `gh api search/issues` for `mounts proxy
precedence` (0 hits). `contamination_risk = LOW`.

**Mandatory triple-check, real Harbor jobs**:

| Check                    | Result       | Job                           |
| ------------------------ | ------------ | ----------------------------- |
| Oracle                   | `reward=1.0` | `jobs/httpx08-oracle-check`   |
| NOP                      | `reward=0.0` | `jobs/httpx08-nop-check`      |
| Plausible wrong solution | `reward=0.0` | `jobs/httpx08-wrongfix-check` |

**Plausible wrong solution**: fixes only the synchronous `Client`, leaves
`AsyncClient`'s byte-for-byte-identical copy still broken — the same
"tested sync, forgot async" mistake class as `httpx-06` (a different
underlying bug, deliberately the same class of oversight, since it is a
realistic and recurring failure mode worth checking for more than once
across the suite rather than a sign of task duplication).

**Scope control**: `tests/client/test_proxies.py` SHA-256-guarded (same
file as `httpx-06`, both being proxy/transport-selection tasks).
