#!/usr/bin/env python3
"""Ueberfuehrt die von pi-duel bereits erzeugten Artefakte (results.jsonl,
patches/, transcripts/, tool-traces/, fingerprints/) fuer einen run_id in
die von Paket 2 erwartete Struktur
(04_RESULTS_TEMPLATE/{pi,codex}/trial-0N/*), s.
02_RUNNER_PRIVATE/03_EVIDENCE_CAPTURE.md.

MUSS vor `pi-duel cleanup <run_id>` laufen: final-tree.sha256 braucht den
noch existierenden Workdir.

Nutzung:
    harvest_gui_trial.py <run_id> --trial <n>
"""

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

WORKSPACE_DIR = Path.home() / ".local/state/real-duel/obench-workspace"
RESULTS_PATH = WORKSPACE_DIR / "results.jsonl"
RESULTS_ROOT = Path(
    "/home/d/desk/02_PI_VS_CODEX_GUI_HARNESS_BENCHMARK/04_RESULTS_TEMPLATE"
)
HARNESS_DIR = {"pi-real": "pi", "codex-real": "codex"}


def _rows_for_run(run_id_base):
    rows = []
    with open(RESULTS_PATH, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            row = json.loads(line)
            if run_id_base in row.get("patch_path", ""):
                rows.append(row)
    return rows


def _final_response_from_transcript(harness, text):
    """Best-effort: letzte substanzielle Assistant-Nachricht aus dem
    JSON-Event-Trajectory extrahieren. Bei Parsing-Unsicherheit wird das
    unveraendert vermerkt statt eine falsche Antwort vorzutaeuschen."""
    lines = [l for l in text.splitlines() if l.strip().startswith("{")]
    last_text = None
    for line in lines:
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if harness == "pi-real" and event.get("type") == "message_end":
            msg = event.get("message", {})
            if msg.get("role") == "assistant":
                parts = [
                    c.get("text", "") for c in msg.get("content", [])
                    if isinstance(c, dict) and c.get("type") == "text"
                ]
                if parts:
                    last_text = "\n".join(parts)
        elif harness == "codex-real" and event.get("type") in (
            "item.completed", "response.completed",
        ):
            item = event.get("item") or event.get("response") or {}
            text_val = item.get("text") or item.get("content")
            if isinstance(text_val, str) and text_val.strip():
                last_text = text_val
    if last_text:
        return last_text
    return (
        "[automatische Extraktion unsicher -- siehe trajectory/raw.txt fuer "
        "die vollstaendige, unveraenderte Ausgabe]"
    )


def harvest(run_id_base, trial):
    rows = _rows_for_run(run_id_base)
    if not rows:
        sys.exit(f"keine results.jsonl-Zeilen fuer run_id {run_id_base!r} gefunden")

    for row in rows:
        harness = row["harness"]
        arm_dir = HARNESS_DIR[harness]
        dest = RESULTS_ROOT / arm_dir / f"trial-{trial:02d}"
        dest.mkdir(parents=True, exist_ok=True)

        patch_src = WORKSPACE_DIR / row["patch_path"]
        shutil.copy2(patch_src, dest / "candidate.patch")

        workdir = Path(row["workdir"])
        if workdir.exists():
            proc = subprocess.run(
                ["find", str(workdir), "-type", "f", "-not", "-path", "*/.git/*"],
                capture_output=True, text=True, check=True,
            )
            files = sorted(proc.stdout.splitlines())
            hash_proc = subprocess.run(
                ["sha256sum", *files], capture_output=True, text=True, check=False,
            )
            (dest / "final-tree.sha256").write_text(
                hash_proc.stdout.replace(str(workdir) + "/", "")
            )
            status_proc = subprocess.run(
                ["git", "-C", str(workdir), "status", "--porcelain"],
                capture_output=True, text=True, check=False,
            )
            (dest / "untracked-manifest.txt").write_text(
                "Hinweis: candidate.patch enthaelt bereits den vollen Inhalt neuer/"
                "untracked Dateien (git add -N vor dem Diff). Diese Datei ist nur "
                "der git-status-Schnappschuss zum Erntezeitpunkt.\n\n"
                + status_proc.stdout
            )
        else:
            (dest / "final-tree.sha256").write_text("workdir bereits entfernt\n")

        transcript_name = f"{run_id_base}_{arm_dir}.txt"
        transcript_src = WORKSPACE_DIR / "transcripts" / transcript_name
        traj_dir = dest / "trajectory"
        traj_dir.mkdir(exist_ok=True)
        if transcript_src.exists():
            shutil.copy2(transcript_src, traj_dir / "raw.txt")
            text = transcript_src.read_text(encoding="utf-8", errors="replace")
            (dest / "candidate-final-response.md").write_text(
                _final_response_from_transcript(harness, text)
            )

        tool_trace_rel = row.get("tool_trace_path")
        if tool_trace_rel:
            tool_trace_src = WORKSPACE_DIR / tool_trace_rel
            if tool_trace_src.exists():
                shutil.copy2(tool_trace_src, dest / "tool-trace.json")

        run_json = {
            "benchmark_version": "gui-greenfield-v1",
            "harness": harness,
            "trial": trial,
            "task": row.get("task"),
            "model": row.get("model"),
            "reasoning": "high",
            "wall_time_s": row.get("wall_time_s"),
            "exit_reason": row.get("error") or ("ok" if row.get("completed") else "incomplete"),
            "operator_intervention_count": 0,
            "comparable": row.get("comparable"),
            "comparable_reason": row.get("comparable_reason"),
            "gates": row.get("gates"),
            "patch_sha256": row.get("patch_sha256"),
            "run_id": row.get("run_id"),
            "ts_iso": row.get("ts_iso"),
        }
        (dest / "run.json").write_text(json.dumps(run_json, indent=2, ensure_ascii=False))
        (dest / "telemetry.json").write_text(
            json.dumps(row.get("telemetry"), indent=2, ensure_ascii=False)
        )
        (dest / "failure-classification.json").write_text(json.dumps({
            "primary_class": None,
            "secondary_classes": [],
            "note": "manuelle Klassifikation nach Paket 2 03_EVALUATOR_PRIVATE/06_FAILURE_TAXONOMY.md noch ausstehend",
        }, indent=2))
        (dest / "operator-events.jsonl").write_text("")
        screenshots_dir = dest / "screenshots"
        screenshots_dir.mkdir(exist_ok=True)
        (screenshots_dir / "README.md").write_text(
            "Screenshots sind ein Post-hoc-Schritt gegen den gebauten Patch "
            "(Szenario-Matrix 03_EVALUATOR_PRIVATE/03_SCENARIO_MATRIX.md), "
            "nicht Teil der Laufzeit-Evidenz -- hier noch nicht erzeugt.\n"
        )
        tests_dir = dest / "tests"
        tests_dir.mkdir(exist_ok=True)

        print(f"geerntet: {harness} trial-{trial:02d} -> {dest}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run_id")
    parser.add_argument("--trial", type=int, required=True)
    args = parser.parse_args()
    harvest(args.run_id, args.trial)
