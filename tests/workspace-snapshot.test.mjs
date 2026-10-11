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
  GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Snapshot Test",
  GIT_AUTHOR_EMAIL: "snapshot@example.test",
  GIT_COMMITTER_NAME: "Snapshot Test",
  GIT_COMMITTER_EMAIL: "snapshot@example.test",
};

async function collectWithoutGit(workspace, options) {
  const originalPath = process.env.PATH;
  const emptyPath = mkdtempSync(path.join(tmpdir(), "pi-no-git-bin-"));
  process.env.PATH = emptyPath;
  try {
    return await collectWorkspaceSnapshot(workspace, options);
  } finally {
    process.env.PATH = originalPath;
    rmSync(emptyPath, { recursive: true, force: true });
  }
}

try {
  const workspace = mkdtempSync(path.join(tmpdir(), "pi-no-git-snapshot-"));
  const outside = mkdtempSync(path.join(tmpdir(), "pi-no-git-outside-"));
  try {
    writeFileSync(path.join(workspace, "notes.txt"), "before\n");
    mkdirSync(path.join(workspace, "nested"));
    writeFileSync(path.join(outside, "harmless.txt"), "outside\n");
    symlinkSync(outside, path.join(workspace, "external-link"));

    const first = await collectWithoutGit(workspace);
    const same = await collectWithoutGit(workspace);
    assert.equal(
      first.ok,
      true,
      "a plain directory has a valid filesystem snapshot",
    );
    assert.equal(first.snapshot.vcs, "none");
    assert.equal(first.snapshot.workspaceRoot, workspace);
    assert.equal(first.snapshot.fingerprint, same.snapshot.fingerprint);
    assert.equal(first.snapshot.filesystemEntries, 3);
    assert.equal(first.snapshot.filesystemInventoryMode, "in-memory");

    const streamed = await collectWithoutGit(workspace, {
      filesystemStreamingThreshold: 1,
    });
    assert.equal(
      streamed.ok,
      true,
      "crossing the soft inventory threshold still produces a complete snapshot",
    );
    assert.equal(streamed.snapshot.filesystemEntries, 3);
    assert.equal(streamed.snapshot.filesystemInventoryMode, "streamed");
    const streamedAgain = await collectWithoutGit(workspace, {
      filesystemStreamingThreshold: 1,
    });
    assert.equal(
      streamed.snapshot.fingerprint,
      streamedAgain.snapshot.fingerprint,
      "streamed filesystem fingerprints are deterministic",
    );

    writeFileSync(
      path.join(workspace, "notes.txt"),
      "changed with a different size\n",
    );
    const changed = await collectWithoutGit(workspace);
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
    execFileSync("git", ["commit", "--quiet", "-m", "base"], {
      cwd: repository,
      env,
    });
    const snapshot = await collectWorkspaceSnapshot(repository);
    assert.equal(snapshot.ok, true);
    assert.equal(
      snapshot.snapshot.vcs,
      undefined,
      "Git retains the existing snapshot format",
    );
    assert.notEqual(snapshot.snapshot.head, "");
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }

  const parent = mkdtempSync(path.join(tmpdir(), "pi-parent-snapshot-"));
  try {
    const nestedRepo = path.join(parent, "nested-repository");
    mkdirSync(nestedRepo);
    execFileSync("git", ["init", "--quiet"], { cwd: nestedRepo, env });
    writeFileSync(path.join(nestedRepo, "tracked.txt"), "nested\n");
    execFileSync("git", ["add", "tracked.txt"], { cwd: nestedRepo, env });
    execFileSync("git", ["commit", "--quiet", "-m", "nested base"], {
      cwd: nestedRepo,
      env,
    });
    const beforeStatus = await collectWithoutGit(parent);
    assert.equal(
      beforeStatus.ok,
      true,
      "a plain parent snapshots a nested repository",
    );
    execFileSync("git", ["status", "--short"], { cwd: nestedRepo, env });
    const afterStatus = await collectWithoutGit(parent);
    assert.equal(afterStatus.ok, true);
    assert.equal(
      afterStatus.snapshot.fingerprint,
      beforeStatus.snapshot.fingerprint,
      "git status in a nested repository does not churn its parent's filesystem fingerprint",
    );
    writeFileSync(path.join(nestedRepo, "tracked.txt"), "changed\n");
    const afterNestedEdit = await collectWithoutGit(parent);
    assert.equal(afterNestedEdit.ok, true);
    assert.notEqual(
      afterNestedEdit.snapshot.fingerprint,
      afterStatus.snapshot.fingerprint,
      "nested repository working-tree edits change the parent filesystem fingerprint",
    );
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }

  const outerRepository = mkdtempSync(
    path.join(tmpdir(), "pi-outer-snapshot-"),
  );
  try {
    execFileSync("git", ["init", "--quiet"], { cwd: outerRepository, env });
    const nestedRepository = path.join(outerRepository, "nested-repository");
    mkdirSync(nestedRepository);
    execFileSync("git", ["init", "--quiet"], { cwd: nestedRepository, env });
    writeFileSync(path.join(nestedRepository, "tracked.txt"), "nested\n");
    execFileSync("git", ["add", "tracked.txt"], {
      cwd: nestedRepository,
      env,
    });
    execFileSync("git", ["commit", "--quiet", "-m", "nested base"], {
      cwd: nestedRepository,
      env,
    });
    const beforeNestedEdit = await collectWorkspaceSnapshot(outerRepository);
    assert.equal(
      beforeNestedEdit.ok,
      true,
      "a Git parent can fingerprint a nested repository without scanning its `.git` directory",
    );
    writeFileSync(path.join(nestedRepository, "tracked.txt"), "changed\n");
    const afterNestedEdit = await collectWorkspaceSnapshot(outerRepository);
    assert.equal(afterNestedEdit.ok, true);
    assert.notEqual(
      afterNestedEdit.snapshot.fingerprint,
      beforeNestedEdit.snapshot.fingerprint,
      "a nested repository working-tree edit changes the parent Git fingerprint",
    );

    const inner = path.join(outerRepository, "inner-worktree");
    mkdirSync(inner);
    writeFileSync(
      path.join(inner, ".git"),
      "gitdir: ../.git/worktrees/inner\n",
    );
    writeFileSync(path.join(inner, "file.txt"), "content\n");
    const nested = await collectWithoutGit(outerRepository);
    assert.equal(
      nested.ok,
      true,
      "filesystem inventory includes a nested worktree without its `.git` metadata",
    );
  } finally {
    rmSync(outerRepository, { recursive: true, force: true });
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
