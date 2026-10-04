import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { collectWorkspaceSnapshot } from "../shared/workspace-snapshot.mjs";

const env = {
  ...process.env,
  GIT_AUTHOR_NAME: "Snapshot Test",
  GIT_AUTHOR_EMAIL: "snapshot@example.test",
  GIT_COMMITTER_NAME: "Snapshot Test",
  GIT_COMMITTER_EMAIL: "snapshot@example.test",
};

try {
  const workspace = mkdtempSync(path.join(tmpdir(), "pi-no-git-snapshot-"));
  const outside = mkdtempSync(path.join(tmpdir(), "pi-no-git-outside-"));
  try {
    writeFileSync(path.join(workspace, "notes.txt"), "before\n");
    mkdirSync(path.join(workspace, "nested"));
    writeFileSync(path.join(outside, "harmless.txt"), "outside\n");
    symlinkSync(outside, path.join(workspace, "external-link"));

    const first = await collectWorkspaceSnapshot(workspace);
    const same = await collectWorkspaceSnapshot(workspace);
    assert.equal(first.ok, true, "a plain directory has a valid filesystem snapshot");
    assert.equal(first.snapshot.vcs, "none");
    assert.equal(first.snapshot.workspaceRoot, workspace);
    assert.equal(first.snapshot.fingerprint, same.snapshot.fingerprint);

    writeFileSync(path.join(workspace, "notes.txt"), "changed with a different size\n");
    const changed = await collectWorkspaceSnapshot(workspace);
    assert.equal(changed.ok, true);
    assert.notEqual(changed.snapshot.fingerprint, first.snapshot.fingerprint);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }

  const repository = mkdtempSync(path.join(tmpdir(), "pi-git-snapshot-"));
  try {
    execFileSync("git", ["init", "--quiet"], { cwd: repository, env });
    writeFileSync(path.join(repository, "tracked.txt"), "tracked\n");
    execFileSync("git", ["add", "tracked.txt"], { cwd: repository, env });
    execFileSync("git", ["commit", "--quiet", "-m", "base"], { cwd: repository, env });
    const snapshot = await collectWorkspaceSnapshot(repository);
    assert.equal(snapshot.ok, true);
    assert.equal(snapshot.snapshot.vcs, undefined, "Git retains the existing snapshot format");
    assert.notEqual(snapshot.snapshot.head, "");
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
