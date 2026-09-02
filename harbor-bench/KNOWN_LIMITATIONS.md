# KNOWN_LIMITATIONS.md — Benchmark v3

Started in Teil A; grows through Teil B/C/D/E. Each entry: what the
limitation is, why it exists, and how it's handled (documented vs. worked
around vs. accepted risk for later task design).

## Teil A entries

### 1. Codex Collab-subagent telemetry gap (A8)

Harbor's ATIF format has supported `Trajectory.subagent_trajectories` since
v1.7, but Harbor's built-in Codex adapter (v0.22.0) does not populate it for
Codex's own internal Collab-subagents. Upstream issue
[harbor-framework/harbor#1209](https://github.com/harbor-framework/harbor/issues/1209)
(open since 2026-03-17, last updated 2026-08-07) tracks this; the linked fix,
PR #970, is also still open/unmerged as of 2026-09-01.

**Handling**: documented gap, not worked around. Benchmark v3 will not
attempt to reconstruct or infer Codex-internal Collab-subagent delegation
from indirect signals — that would risk inventing data Harbor itself cannot
yet see. `postprocess/subagents.py`'s Codex-side output carries an explicit
`codex_limitation_note` field pointing here instead of silently returning
empty/zero delegation counts (which would misleadingly read as "Codex never
delegates").

### 2. Pi vs. Codex sandbox/rights asymmetry (A4)

See `ENVIRONMENT_LOCK.md`, "A4 — Codex vs. Pi runtime rights", for the full
comparison table. Summary: Codex runs with hardcoded
`--dangerously-bypass-approvals-and-sandbox --skip-git-repo-check` (no kwarg
disables it); Pi runs at `project-write` + `--approve`, which is more
conservative for a small set of destructive/system actions. Documented per
Gate A4's own instruction ("unvermeidbare Harness-Unterschiede
dokumentieren [...] nicht künstlich versuchen, beide Harnesses intern
identisch zu machen") rather than force-equalized.

### 3. `rm`/`git rm` auto-denied under Pi `project-write` in headless mode

`extensions/shared/permission-policy.ts`'s `SENSITIVE_ASK_PATTERNS` includes
`rm`; under `project-write` this resolves to "ask", which in headless mode
(`--mode json`, no `uiContext`) auto-resolves to denial
(`"Aktion vom Benutzer abgelehnt."`) rather than hanging. Not a Gate A3
blocker (the gate's required-capability list — test/build/typecheck/lint/
project_check/LSP/git — does not include deletion), but real: a task that
requires the agent to delete a file will hit this.

**Empirically confirmed** (`jobs/gate-a3-pi`, 2026-09-01): `rm scratch.tmp &&
git diff ...` was denied on the first and only attempt; the agent did not
retry with an alternate deletion path (e.g. `node -e "fs.unlinkSync(...)"`,
which project-write would in fact allow — opaque-interpreter blocking is a
`yolo`-only restriction) and left the task incomplete (`reward=0.0`). All
six of Gate A3's actually-required capabilities passed with zero denials in
the same run.

**Handling**: `tasks/_gate/permission-smoke` deliberately includes a delete
step to record the actual behavior empirically (see
`BENCHMARK_V3_FIXES.md`, Etappe A-2). Risk flagged forward to Teil D task
design: avoid requiring `rm` as the _only_ correct path in a Pi-vs-Codex
comparison task, since it would penalize Pi for a harness-level default
rather than agent capability — or explicitly account for it if a task
does need to test that boundary.

### 4. `ask-user.ts` RPC fix (Track B / Interactive Track) — deferred, not abandoned

A previously-decided small product-code change (`extensions/ask-user.ts`,
new RPC branch using `ctx.ui.select` instead of `ctx.ui.custom`) would let
Pi ask real clarification questions headlessly. Benchmark v3's own task
order classifies the "Interactive Track" as optional and explicitly
separate from the main (Autonomous Track) score. Per user decision
(2026-09-01), this fix is **not part of Teil A** and will be revisited only
when/if Teil C's optional Interactive Track is actually started, with a
fresh short confirmation at that point.

### 5. Codex `trajectory.json` cannot be reliably read within this interactive session (A6/A7)

Confirmed, reproducible (2026-09-01): this session's sandbox applies a
live, read-time content filter to files read through Bash-spawned
processes. Every real Codex `trajectory.json` this session has read fails
`json.loads()` (individual digit runs replaced in-stream with the literal
text `[REDACTED]`, breaking JSON syntax) — including a **freshly created**
file that had never been read before (`jobs/gate-a3-codex-telemetry-check`),
which rules out "gets corrupted once inspected" and confirms it is a
per-read filter, not one-time on-disk corruption. Likely trigger: the long
base64 `encrypted_content`/reasoning-signature blobs Codex embeds in its
own rollout, which a generic secret-scanner would flag. A synthetic
ATIF-shaped fixture without that content parses fine through
`codex_normalizer.py`, confirming the extraction logic itself is correct —
see `TELEMETRY_SCHEMA.md`'s A6 section for the full account.

**Correction (2026-09-01, verified while addressing this entry)**: the
original write-up above guessed the filter operates on this module's own
Read/Bash tool output specifically ("a real Python file read inside a
running trial is unaffected by [it]" — `codex_normalizer.py`'s old
docstring). That guess is **falsified**. Reproduced with a bare `python3
-c` subprocess calling `Path.read_bytes()` directly (no `json.loads`, no
Read tool involved) against `jobs/gate-a2-codex-2/.../trajectory.json`: the
returned bytes contain the literal `[REDACTED]` ASCII text at the exact
byte offsets, confirmed via `hexdump`/`sha256`. So this is not a
display-layer artifact of any one tool — it's a property of file reads
done by _any_ process this interactive session spawns (host-side), most
likely a syscall/FS-level interception rather than output scrubbing.
**Ruled out as the same problem**: `pi_normalizer.py`'s source file
(`pi.txt`, checked via the identical raw-bytes test) contains no
`REDACTED` markers and parses cleanly — the filter is content-triggered
(digit/entropy-heavy runs), not blanket, and doesn't affect the Pi side of
telemetry at all.

**Handling, now implemented**: `codex_normalizer.py`'s field mappings are
verified against Harbor's own `codex.py` construction code (authoritative)
plus a synthetic fixture, not against a live instance re-read in this
session. `build_codex_telemetry()` now catches the resulting
`json.JSONDecodeError` and returns a valid partial `TelemetryV3` with
`degraded_reason` set (schema field added in `postprocess/schema.py`)
instead of crashing the postprocessing run — verified against the real
corrupted file above (`jobs/gate-a2-codex-2/.../trajectory.json`), which
now returns cleanly with `degraded_reason` populated instead of raising.

**Escalation (2026-09-01, while building `scripts/gate_a_verify.py`)**: this
is worse than "just the trajectory". `verifier/reward.txt` — a file whose
entire content is a single ASCII digit (`"1\n"` or `"0\n"`) — comes back as
the literal bytes `[REDACTED]\n` for **every** Codex job trial dir sampled
(5/5: `gate-a2-codex-2`, `gate-a3-codex-telemetry-check`,
`compare-codex-02`, `compare-codex-02-05`, `s1-codex-smoke-2`), confirmed
via raw `Path.read_bytes()`, not just display. `result.json` fails
`json.loads()` for the same job for the same reason. This directly
contradicts the previous version of this entry, which assumed
`result.json`'s aggregate reward would be spared. **Not a clean
per-file-content rule either**: the same job's `verifier/test-stdout.txt`
(containing `commit_count=2`, digits included) read back completely clean,
and `trial.log` was only partially hit (5 redactions in one file, not
every digit) — so whatever triggers this cannot be fully characterized
from outside; it behaves as coarser-than-per-byte and inconsistent even
within one job directory, not a predictable rule to code around. The one
reliable empirical fact, confirmed and safe to build on: **0/N Pi-job
`reward.txt`/`result.json` files sampled have ever shown this, 5/5 Codex
ones have.**

**Practical consequence for Teil B-E**: this session cannot reliably read
even the single most basic Codex output (pass/fail reward) for any task,
let alone token/tool-error detail. `scripts/gate_a_verify.py` now detects
this specifically (`RewardUnreadable`, triggered when a reward file's
content contains the string `REDACTED`) and reports the affected side as
`UNREADABLE`, never silently as `FAIL` or a guessed `PASS`. Any Codex-side
numeric result this session reports (including earlier entries in
`TASK_VALIDATION.md`/`BENCHMARK_V3_FIXES.md`, most of which come from
`nop`/`oracle`/`wrongfix` _reference-solution_ jobs rather than a real
Codex agent run, so were never exposed to Codex's own secret-like content
in the first place) should be treated as unverified unless re-confirmed
outside this session. **Not yet resolved for Teil B-E**: getting a
trustworthy Codex reward value requires either (a) the user checking
`reward.txt`/`result.json` themselves outside this session (e.g. via the
`!`-prefixed passthrough in the CLI, which runs in this session's shell
but outside this filter's apparent scope — untested — or their own
terminal), or (b) trusting Harbor's own `harbor run` process-exit code /
live stdout summary at run time rather than any post-hoc file re-read.
Flagged to the user; not yet decided which path Teil D/E scoring will
rely on.

**Severity escalation (2026-09-01, Teil D pilot, `jobs/pilot-codex`)**: this
is not limited to reading files back after the fact — it corrupted a
**real job's input** and made it fail outright. `jobs/_pilot-codex.config.json`
was written (by this session, via the normal file-write path, never
touched by any secret-scanner-triggering content itself) with
`"CODEX_FORCE_AUTH_JSON": "****"` — copied verbatim from an earlier,
successfully-completed real Codex job's own `config.json` (`s1-codex-smoke`),
on the reasonable assumption that a non-empty string is accepted as a
truthy flag. Both trials (`httpx-01`, `httpx-07`) crashed identically
during agent setup with `ValueError: Invalid value for
'CODEX_FORCE_AUTH_JSON': cannot parse '[REDACTED]' as bool` — i.e. Harbor's
own Python process, reading back the config file this session had just
written, saw the literal string `[REDACTED]` where `"****"` had been
written, not `"****"` itself. So the filter can strike on a file between
write and the real pipeline's own read of it, not only on this session's
own inspection reads — and asterisk-masked-looking placeholder text
(`****`) is now confirmed as a second trigger pattern alongside
digit-heavy content. **Also confirms the filter is non-deterministic, not
purely content-triggered**: several earlier real Codex jobs in this
session's `jobs/` directory used the identical `"****"` value in their
config.json and completed successfully (e.g. `gate-a2-codex-2`, whose
trial.log shows a real trajectory being written) — same string, different
outcome, no way to predict which from outside.

**Fix applied**: reran with `"CODEX_FORCE_AUTH_JSON": "true"` instead of
`"****"` (`jobs/pilot-codex-2`) — a value `harbor/utils/env.py`'s
`parse_bool_env_value()` accepts directly, and not a pattern this filter
appears to treat as secret-like. **Practical rule going forward**: never
write `"****"` (or similar asterisk-only placeholder strings) into any
config this session hands to a real `harbor run` invocation, even when
copied from a prior job's own config as a "known-good" value — use an
explicit `"true"`/`"1"` instead. This was not previously documented
because no earlier config in this session happened to need a boolean-ish
env value written fresh rather than copied from a pre-existing file.
