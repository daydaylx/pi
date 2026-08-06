import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import { relative, resolve } from "node:path";

export const WORKSPACE_SNAPSHOT_SCHEMA_VERSION = "1";

function git(cwd, args, encoding = "utf8") {
  return execFileSync("git", args, {
    cwd,
    encoding,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function nullSeparated(output) {
  return output.split("\0").filter(Boolean);
}

function parseNameStatus(output) {
  const fields = nullSeparated(output);
  const changes = [];
  const renames = [];
  const deletions = [];

  for (let index = 0; index < fields.length; index += 1) {
    const status = fields[index];
    const kind = status[0];
    if (kind === "R" || kind === "C") {
      const from = fields[++index];
      const to = fields[++index];
      if (!from || !to) throw new Error("Malformed Git rename status.");
      renames.push({ from, to });
      changes.push({ status: kind, path: to });
      continue;
    }
    const path = fields[++index];
    if (!path) throw new Error("Malformed Git status.");
    changes.push({ status: kind, path });
    if (kind === "D") deletions.push({ path });
  }

  return { changes, renames, deletions };
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function untrackedContentFingerprints(worktree, paths) {
  return paths.map((path) => {
    const absolute = resolve(worktree, path);
    if (relative(worktree, absolute).startsWith("..")) {
      throw new Error("Untracked path is outside the workspace.");
    }
    let stat;
    try {
      stat = lstatSync(absolute);
    } catch {
      throw new Error("Untracked path is unavailable.");
    }
    const content = stat.isSymbolicLink()
      ? readlinkSync(absolute)
      : stat.isFile()
        ? readFileSync(absolute)
        : undefined;
    if (content === undefined)
      throw new Error("Untracked path is not a regular file or symbolic link.");
    return { path, sha256: hash(content) };
  });
}

/**
 * Return the one canonical, content-sensitive representation of a Git
 * workspace. It contains paths and hashes only; patches and file contents are
 * intentionally never returned to benchmark results.
 */
export function collectWorkspaceSnapshot(worktree) {
  const head = git(worktree, ["rev-parse", "HEAD"]).trim();
  const stagedStatus = parseNameStatus(
    git(worktree, ["diff", "--cached", "--name-status", "-z", "-M"]),
  );
  const unstagedStatus = parseNameStatus(
    git(worktree, ["diff", "--name-status", "-z", "-M"]),
  );
  const untracked = nullSeparated(
    git(worktree, ["ls-files", "--others", "--exclude-standard", "-z"]),
  ).sort();
  const stagedPatch = git(worktree, [
    "diff",
    "--cached",
    "--no-ext-diff",
    "--binary",
    "-M",
  ]);
  const unstagedPatch = git(worktree, [
    "diff",
    "--no-ext-diff",
    "--binary",
    "-M",
  ]);
  const untrackedContent = untrackedContentFingerprints(worktree, untracked);
  const changedFiles = [
    ...stagedStatus.changes.map((entry) => entry.path),
    ...unstagedStatus.changes.map((entry) => entry.path),
    ...stagedStatus.renames.flatMap(({ from, to }) => [from, to]),
    ...unstagedStatus.renames.flatMap(({ from, to }) => [from, to]),
    ...untracked,
  ];
  const snapshot = {
    schemaVersion: WORKSPACE_SNAPSHOT_SCHEMA_VERSION,
    head,
    staged: stagedStatus.changes.sort((a, b) => a.path.localeCompare(b.path)),
    unstaged: unstagedStatus.changes.sort((a, b) =>
      a.path.localeCompare(b.path),
    ),
    untracked,
    renames: [...stagedStatus.renames, ...unstagedStatus.renames].sort((a, b) =>
      `${a.from}\0${a.to}`.localeCompare(`${b.from}\0${b.to}`),
    ),
    deletions: [...stagedStatus.deletions, ...unstagedStatus.deletions].sort(
      (a, b) => a.path.localeCompare(b.path),
    ),
    changedFiles: [...new Set(changedFiles)].sort(),
  };
  const fingerprintInput = JSON.stringify({
    ...snapshot,
    stagedPatchSha256: hash(stagedPatch),
    unstagedPatchSha256: hash(unstagedPatch),
    untrackedContent,
  });

  return { ...snapshot, fingerprint: hash(fingerprintInput) };
}
