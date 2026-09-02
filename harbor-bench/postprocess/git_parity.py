"""Gate A2 (git parity) checks: Benchmark v3 Teil A.

The git baseline is baked into each task's Dockerfile (not the Pi adapter),
because the Dockerfile is the only place that applies identically to both
the Pi adapter (agents/pi_harness/agent.py) and Harbor's built-in Codex
adapter -- see the plan file, "A2 Deep-Dive". This module lets
scripts/gate_a_verify.py (and, later, Teil B/D task validation) check that
every task's Dockerfile actually carries that block, without re-parsing
Dockerfile syntax by hand at every call site.
"""

import re
from pathlib import Path

_REQUIRED_MARKERS = (
    re.compile(r"git init"),
    re.compile(r"git add"),
    re.compile(r"git commit"),
    re.compile(r"safe\.directory"),
)

# Re-baseline markers: for a task Dockerfile that builds `FROM` one of our
# own, already-verified snapshot images (e.g. httpx-snapshot:*, Teil B4)
# rather than a bare public base image, `git init`/`safe.directory` were
# already established once in the snapshot's own Dockerfile -- requiring
# them again in every task built on top would just be dead weight. Such a
# task only needs to prove it re-committed a fresh baseline on top of
# whatever mutation it applied (see tasks/httpx-01-deep-diagnosis/environment/Dockerfile).
_REBASELINE_MARKERS = (
    re.compile(r"git add"),
    re.compile(r"git commit"),
)

# Prefixes that mean "this FROM references a bare public image with no git
# baseline of its own" -- such a Dockerfile MUST carry the full block itself.
_BARE_BASE_IMAGE_PREFIXES = ("node:", "python:", "ubuntu:", "debian:", "alpine:")


def _from_image(text: str) -> str | None:
    match = re.search(r"(?m)^FROM\s+(\S+)", text)
    return match.group(1) if match else None


def check_dockerfile_has_git_baseline(dockerfile_path: Path) -> bool:
    """True iff `dockerfile_path` bakes in a git baseline, harness-neutral,
    at build time -- either the full canonical block (git init + add +
    commit + a safe.directory config), or, when `FROM` references one of
    our own pre-baselined snapshot images rather than a bare public base
    image, just the re-baseline commit on top of it."""
    if not dockerfile_path.is_file():
        return False
    text = dockerfile_path.read_text()
    if all(marker.search(text) for marker in _REQUIRED_MARKERS):
        return True

    from_image = _from_image(text)
    builds_on_bare_image = from_image is None or from_image.startswith(
        _BARE_BASE_IMAGE_PREFIXES
    )
    if builds_on_bare_image:
        return False
    return all(marker.search(text) for marker in _REBASELINE_MARKERS)


def check_all_tasks(tasks_dir: Path) -> dict[str, bool]:
    """Maps task path (relative to `tasks_dir`) -> whether its Dockerfile has
    the git baseline. Recursive, so tasks nested under a grouping directory
    (e.g. `_gate/git-parity-smoke`) are found too. Tasks without an
    `environment/Dockerfile` are skipped (e.g. a prebuilt `docker_image`
    task, Teil B/D)."""
    results: dict[str, bool] = {}
    for dockerfile in sorted(tasks_dir.rglob("environment/Dockerfile")):
        task_path = dockerfile.parent.parent.relative_to(tasks_dir)
        results[str(task_path)] = check_dockerfile_has_git_baseline(dockerfile)
    return results


if __name__ == "__main__":
    tasks_root = Path(__file__).parent.parent / "tasks"
    results = check_all_tasks(tasks_root)
    for name, ok in results.items():
        print(f"{'PASS' if ok else 'FAIL'}  {name}")
    if not all(results.values()):
        raise SystemExit(1)
