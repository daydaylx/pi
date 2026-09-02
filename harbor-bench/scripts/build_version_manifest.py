#!/usr/bin/env python3
"""Build v3 MANIFEST.json: source-side facts about what build-tarball.sh
actually packed, frozen at tarball-build time (not at trial-run time -- the
manifest describes what is IN the tarball, per Benchmark v3 Teil A1 "keine
stillen Updates").

Invoked by environments/build-tarball.sh. Prints JSON to stdout.
"""

import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path("/home/d/.pi/agent")


def _git(*args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=REPO_ROOT, capture_output=True, text=True, check=True
    ).stdout.strip()


def collect() -> dict:
    package_json = json.loads((REPO_ROOT / "npm" / "package.json").read_text())
    pi_pkg_path = (
        REPO_ROOT
        / "npm"
        / "node_modules"
        / "@earendil-works"
        / "pi-coding-agent"
        / "package.json"
    )
    pi_cli_version = json.loads(pi_pkg_path.read_text())["version"]

    subagents_spec = package_json.get("devDependencies", {}).get(
        "pi-subagents"
    ) or package_json.get("dependencies", {}).get("pi-subagents", "")
    fork_sha_match = re.search(r"#([0-9a-f]{40})$", subagents_spec)
    if not fork_sha_match:
        raise ValueError(
            f"pi-subagents dependency spec is not git-SHA-pinned: {subagents_spec!r}"
        )

    return {
        "pi_source_git_sha": _git("rev-parse", "HEAD"),
        "pi_source_dirty": bool(_git("status", "--porcelain")),
        "pi_cli_version": pi_cli_version,
        "pi_subagents_fork_sha": fork_sha_match.group(1),
        "node_version_pinned": package_json["engines"]["node"],
        "built_at": datetime.now(timezone.utc).isoformat(),
    }


if __name__ == "__main__":
    json.dump(collect(), sys.stdout, indent=2)
    sys.stdout.write("\n")
    sys.stderr.write(f"MANIFEST.json facts collected from {REPO_ROOT}\n")
