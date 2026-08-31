#!/bin/bash
set -euo pipefail

python3 - <<'PYEOF'
import re

path = "/app/benchmark-fixture/diff-viewer/change-tracker.ts"
with open(path) as f:
    content = f.read()

old_changed_files = """  get changedFiles(): SessionChange[] {
    const result: SessionChange[] = [];
    for (const [, fileChanges] of this.changes) {
      if (fileChanges.length > 0) {
        result.push(fileChanges[fileChanges.length - 1]!);
      }
    }
    // Neueste zuerst
    return result.sort((a, b) => b.timestamp - a.timestamp);
  }"""

new_changed_files = """  get changedFiles(): SessionChange[] {
    const result: SessionChange[] = [];
    for (const fileChanges of this.allChanges()) {
      if (fileChanges.length > 0) {
        result.push(fileChanges[fileChanges.length - 1]!);
      }
    }
    // Neueste zuerst
    return result.sort((a, b) => b.timestamp - a.timestamp);
  }"""

old_total_changes = """  get totalChanges(): number {
    let count = 0;
    for (const changes of this.changes.values()) count += changes.length;
    return count;
  }"""

new_total_changes = """  get totalChanges(): number {
    let count = 0;
    for (const changes of this.allChanges()) count += changes.length;
    return count;
  }

  /** Gemeinsame Iterationsbasis fuer changedFiles/totalChanges. */
  private allChanges(): IterableIterator<SessionChange[]> {
    return this.changes.values();
  }"""

assert old_changed_files in content
assert old_total_changes in content
content = content.replace(old_changed_files, new_changed_files)
content = content.replace(old_total_changes, new_total_changes)

with open(path, "w") as f:
    f.write(content)
PYEOF
