#!/usr/bin/env python3
"""List the tasks available to the real-duel harness."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from workflow_task import load


SCRIPT_DIR = Path(__file__).resolve().parent
TASKS_DIR = SCRIPT_DIR.parent / "tasks"


def collect_tasks(tasks_dir: Path) -> list[dict[str, object]]:
    """Return valid, alphabetically sorted task entries."""
    entries: list[dict[str, object]] = []
    for task_dir in sorted(tasks_dir.iterdir(), key=lambda path: path.name):
        if not task_dir.is_dir() or not (task_dir / "instruction.md").is_file():
            continue

        config = load(task_dir)
        entries.append(
            {
                "name": task_dir.name,
                "has_checker": (task_dir / "checker.sh").exists(),
                "workflows": list(config.supported_workflows),
            }
        )
    return entries


def print_human(entries: list[dict[str, object]]) -> None:
    """Print a compact table for interactive use."""
    headers = ("name", "checker", "workflows")
    rows = [
        (
            str(entry["name"]),
            "yes" if entry["has_checker"] else "no",
            ", ".join(str(workflow) for workflow in entry["workflows"]),
        )
        for entry in entries
    ]
    widths = [
        max(len(header), *(len(row[index]) for row in rows))
        for index, header in enumerate(headers)
    ]

    print("  ".join(header.ljust(widths[index]) for index, header in enumerate(headers)))
    print("  ".join("-" * width for width in widths))
    for row in rows:
        print("  ".join(value.ljust(widths[index]) for index, value in enumerate(row)))


def main() -> None:
    parser = argparse.ArgumentParser(description="List real-duel tasks")
    parser.add_argument(
        "--json",
        action="store_true",
        dest="as_json",
        help="output the task catalog as JSON",
    )
    args = parser.parse_args()
    entries = collect_tasks(TASKS_DIR)

    if args.as_json:
        json.dump(entries, sys.stdout, ensure_ascii=False)
        print()
    else:
        print_human(entries)


if __name__ == "__main__":
    main()
