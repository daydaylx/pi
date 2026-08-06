import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { collectWorkspaceSnapshot } from "../workspace-snapshot.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const collector = join(here, "..", "collect-metrics.mjs");
const worktree = mkdtempSync(join(tmpdir(), "pi-workspace-snapshot-"));

function git(args) {
  return execFileSync("git", args, { cwd: worktree, encoding: "utf8" });
}

try {
  git(["init", "--quiet"]);
  git(["config", "user.email", "snapshot@example.test"]);
  git(["config", "user.name", "Snapshot Test"]);
  writeFileSync(join(worktree, "tracked.txt"), "before\n");
  writeFileSync(join(worktree, "rename-from.txt"), "rename me\n");
  writeFileSync(join(worktree, "delete-me.txt"), "remove me\n");
  git(["add", "."]);
  git(["commit", "--quiet", "-m", "baseline"]);

  const clean = collectWorkspaceSnapshot(worktree);
  assert.deepEqual(clean.changedFiles, []);
  assert.equal(clean.schemaVersion, "1");
  assert.equal(collectWorkspaceSnapshot(worktree).fingerprint, clean.fingerprint);

  writeFileSync(join(worktree, "tracked.txt"), "unstaged\n");
  writeFileSync(join(worktree, "staged.txt"), "staged\n");
  git(["add", "staged.txt"]);
  git(["mv", "rename-from.txt", "rename-to.txt"]);
  unlinkSync(join(worktree, "delete-me.txt"));
  git(["add", "delete-me.txt"]);
  writeFileSync(join(worktree, "untracked.txt"), "one\ntwo\n");

  const snapshot = collectWorkspaceSnapshot(worktree);
  assert.deepEqual(snapshot.changedFiles, [
    "delete-me.txt",
    "rename-from.txt",
    "rename-to.txt",
    "staged.txt",
    "tracked.txt",
    "untracked.txt",
  ]);
  assert(snapshot.staged.some((entry) => entry.status === "D"));
  assert(snapshot.unstaged.some((entry) => entry.path === "tracked.txt"));
  assert.deepEqual(snapshot.untracked, ["untracked.txt"]);
  assert.deepEqual(snapshot.renames, [
    { from: "rename-from.txt", to: "rename-to.txt" },
  ]);
  assert(snapshot.deletions.some((entry) => entry.path === "delete-me.txt"));
  assert.notEqual(snapshot.fingerprint, clean.fingerprint);
  assert.equal(collectWorkspaceSnapshot(worktree).fingerprint, snapshot.fingerprint);

  const result = JSON.parse(
    execFileSync(process.execPath, [collector, "--task", "snapshot", "--worktree", worktree], {
      encoding: "utf8",
    }),
  );
  assert.deepEqual(result.automatic.diff.changedFiles, snapshot.changedFiles);
  assert.equal(
    result.automatic.diff.snapshot.fingerprint,
    snapshot.fingerprint,
    "the collector reports the canonical snapshot fingerprint",
  );
  assert.equal(result.automatic.diff.changedFileCount, snapshot.changedFiles.length);
  assert.equal(result.automatic.diff.linesAdded, 4);
  assert.equal(result.automatic.diff.linesRemoved, 2);
} finally {
  rmSync(worktree, { recursive: true, force: true });
}
