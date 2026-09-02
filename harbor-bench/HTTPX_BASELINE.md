# HTTPX_BASELINE.md — Benchmark v3 Teil B1-B3

## Pinned baseline

```
HTTPX_BASE_SHA=b5addb64f0161ff6bfe94c124ef76f6a1fba5254
```

- Repository: `encode/httpx`, cloned once into `harbor-bench/repos/httpx/`
  (gitignored — external repo, not vendored into this git history).
- Branch at clone time: `master`. Commit date: 2026-02-23 10:40:42 +0000.
- Description: `0.28.1-24-gb5addb6` (24 commits past the `0.28.1` release
  tag) — "Adapt test_response_decode_text_using_autodetect for chardet 6.0
  (#3773)".
- Chosen because it was the current stable `master` HEAD at pin time and
  passed selection criteria below — **not** cherry-picked to be an
  unusually easy or hard point in history.
- All later trials (Teil C/D/E) use exactly this SHA. No `master` tracking.

## Selection criteria (B2) — checked before freezing

| Criterion                               | Result                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Upstream CI green for this exact commit | **Yes** — GitHub Actions check-runs (`gh api repos/encode/httpx/commits/<sha>/check-runs`): Python 3.9/3.10/3.11/3.12/3.13 all `completed`/`success`, plus Dependabot checks                                                                                                                                                                                                                                    |
| No known broken CI state                | Confirmed via the above, live query, not assumed                                                                                                                                                                                                                                                                                                                                                                |
| Dependencies reproducible               | `environments/httpx-snapshot/baseline-freeze.txt` — full `pip freeze` snapshot of every transitive dependency actually installed for this baseline, so later runs resolve identically instead of drifting with "latest" (httpx's own `requirements.txt` deliberately does NOT pin transitive deps — see its comment: "we're not pinning package dependencies [...] tests need to pass with the latest version") |
| No external infra required              | Confirmed — `scripts/test`'s local test server binds `127.0.0.1` only                                                                                                                                                                                                                                                                                                                                           |
| No mid-migration state                  | None observed; normal incremental commit history                                                                                                                                                                                                                                                                                                                                                                |

## Environment

- Python: `3.12.3` (local `venv`, created by httpx's own `scripts/install`)
- Install command: `sh scripts/install` (creates `venv/`, `pip install -r requirements.txt`, which itself does `-e .[brotli,cli,http2,socks,zstd]`)
- Test commands:
  - `sh scripts/check` — `ruff format --diff`, `mypy`, `ruff check`
  - `venv/bin/python -m pytest -q` — full test suite

## Baseline test result (2026-09-01, run locally, not just trusted from upstream CI)

`scripts/check`: **all green** (`ruff format`: 60 files already formatted;
`mypy`: "Success: no issues found in 60 source files"; `ruff check`: "All
checks passed!", one non-fatal `# noqa` syntax warning on
`httpx/_transports/asgi.py:171`, pre-existing, not from us).

`pytest -q`: **1416 passed, 1 skipped, 1 failed** on the first two
independent runs. **Correction from later Teil C task-validation work**: a
third, unrelated run of the same unmutated baseline (2026-09-01, while
validating `httpx-03-redirect-state`) came back **1417 passed, 1 skipped, 0
failed** — `test_write_timeout[trio]` is genuinely flaky (GC-timing
dependent, matching the root cause below), not deterministically failing
as the first two runs suggested. `tests/test.sh` in every hard-suite task
accounts for this correctly by `--deselect`-ing the test outright rather
than asserting an exact pass/fail count — a run of the real Oracle solution
that happened to hit the "passes" side of this flake would otherwise have
been wrongly scored.

### The one failure — known, upstream-acknowledged, not a regression

`tests/test_timeouts.py::test_write_timeout[trio]` fails with
`pytest.PytestUnraisableExceptionWarning: Exception ignored in:
<async_generator object ByteStream.__aiter__ ...>`.

Verified via the GitHub issue tracker (not assumed): this is
[encode/httpx#3686](https://github.com/encode/httpx/issues/3686), with an
**open, unmerged** fix at
[encode/httpx#3777](https://github.com/encode/httpx/pull/3777) ("Add real
async iterator for ByteStreams"). The PR description reproduces the
_exact_ same warning against `trio==0.31.0` — the same trio version pinned
in httpx's own `requirements.txt` — confirming this is not specific to
this environment. Root cause per the PR: `ByteStream.__aiter__` is a
generator function, which recent `trio` versions can garbage-collect
before exhaustion, in a way `trio` itself treats as a resource warning
that pytest's `unraisableexception` plugin escalates to a hard failure.

**Handling**: documented, accepted skip for this baseline
(`test_write_timeout[trio]` is on the "known unavoidable" list). Not a
functional defect in httpx, not introduced by anything in this pin. Task
design (Teil C) must not build a controlled mutation task around this test
or its neighborhood, since a pre-existing failure there would be
indistinguishable from an intentionally-introduced bug.

### 1 skipped

`tests/client/test_auth.py:273` — "netrc files without a password are
valid from Python >= 3.11" — an intentional, version-gated skip in
httpx's own test suite, not environment-specific.

## Reproducing

```sh
cd harbor-bench/repos/httpx
git checkout b5addb64f0161ff6bfe94c124ef76f6a1fba5254
sh scripts/install
sh scripts/check
venv/bin/python -m pytest -q
```

To match the exact dependency snapshot instead of "whatever `pip` resolves
today": `venv/bin/pip install -r ../../environments/httpx-snapshot/baseline-freeze.txt`
after `scripts/install`.

## B4 — reusable Docker snapshot

Built by `environments/httpx-snapshot/build.sh`: refuses to run if
`repos/httpx`'s checked-out HEAD isn't exactly the pinned SHA above (no
silent re-pin), extracts a pristine copy via `git archive` (no `.git`, no
local `venv`/cache cruft), installs the frozen dependency snapshot plus
`hatchling`/`hatch-fancy-pypi-readme`/`editables` (httpx's own
`[build-system]` requirements, installed up front so the editable install
runs with `--no-build-isolation` instead of a second, separate network
fetch), installs httpx itself editable from the local copy (so an agent's
later edits under `/app/httpx` take effect immediately, no reinstall), then
applies the same canonical git baseline as every other task (Gate A2).

Tag: `httpx-snapshot:b5addb64` (first 8 chars of the pinned SHA). Referenced
by a task's `task.toml` as `[environment] docker_image =
"httpx-snapshot:b5addb64"` instead of a per-task `Dockerfile` build (Harbor
skips the build step entirely when `docker_image` is set and
`force_build=False`, the CLI default) -- built once, reused by every HTTPX
task, no re-fetch or re-build per task or per trial.

**Verified**: a fresh container from this image reproduces the exact same
baseline test result as the local venv (1416 passed, 1 skipped, 1 known
`test_write_timeout[trio]` failure) with normal container networking
(Harbor's actual runtime model -- containers keep a loopback-capable
network namespace; only _external/internet_ access is what B4 asks to
avoid needing, not all networking). One caveat found and corrected during
verification: running the same image under Docker's `--network=none` (no
network namespace at all, not even loopback-adjacent socket behavior)
produces 3 additional failures in `tests/client/test_proxies.py`
(`ConnectError`) -- an artifact of that unrealistically strict test mode,
not a defect in the snapshot; Harbor never runs trials with
`--network=none`, so this does not apply to real trials and is noted here
only so a future re-verification doesn't get confused by it.
