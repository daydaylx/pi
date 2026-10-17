"""Verhaltenstest für die Regeltexte (AGENTS.md, Skills agent-docs und doc-diff).

Kopiert eine Fixture, startet Pi über `pi --mode rpc` (Dialoge werden wie im
Duell protokolliert) und gibt Werkzeugaufrufe, UI-Rückfragen und geänderte
Dateien aus. Der Test misst Verhalten, keine Qualität; k pro Arm ist klein.

Aufruf: benchmarks/behavior/run.py <arm-label> <A|B> <k> [--work <verzeichnis>]
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "duel"))
from pi_rpc import run_rpc  # noqa: E402


def main() -> int:
    args = sys.argv[1:]
    work = Path("/tmp/pi-behavior")
    if "--work" in args:
        i = args.index("--work")
        work = Path(args[i + 1])
        del args[i : i + 2]
    arm, task, k = args
    work.mkdir(parents=True, exist_ok=True)
    subprocess.run([str(HERE / "make-fixtures.sh"), str(work / "fixtures")], check=True)
    run_dir = work / f"{arm}-{task}-{k}"
    shutil.rmtree(run_dir, ignore_errors=True)
    run_dir.mkdir(parents=True)
    repo = run_dir / "repo"
    shutil.copytree(work / "fixtures" / f"fix{task}", repo)
    prompt = (HERE / f"prompt{task}.md").read_text(encoding="utf-8")
    cmd = ["pi", "--mode", "rpc", "--approve", "--session-dir", str(run_dir / "sess")]
    out, _, answers, rc, _ = run_rpc(
        cmd, str(repo), prompt, "Entscheide selbst und arbeite weiter.",
        lambda text, n: True, max_rounds=1, idle_timeout=300, total_timeout=420,
    )
    (run_dir / "out.jsonl").write_text(out, encoding="utf-8")
    (run_dir / "answers.json").write_text(json.dumps(answers, ensure_ascii=False, indent=1), encoding="utf-8")
    tools, git_history = [], 0
    for line in out.splitlines():
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if event.get("type") == "tool_execution_start":
            tools.append(event.get("toolName"))
            blob = json.dumps(event.get("args", event))
            git_history += any(w in blob for w in ("git log", "git blame", "git diff", "git show"))
    status = subprocess.run(["git", "status", "--short"], cwd=repo, capture_output=True, text=True).stdout.strip()
    print(f"{run_dir.name}: rc={rc} tools={len(tools)} git-historie={git_history} "
          f"ask_user={'ask_user' in tools} ui-dialoge={len(answers)} geändert={status or '-'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
