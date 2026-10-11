import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import {
  lstat as lstatAsync,
  readlink as readlinkAsync,
  readdir as readdirAsync,
  realpath as realpathAsync,
} from "node:fs/promises";
import { createReadStream, lstatSync, readlinkSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

// Version 2 hardened Git patch hashes; version 3 includes nested worktree
// state in untracked-directory fingerprints.
export const WORKSPACE_SNAPSHOT_SCHEMA_VERSION = "3";
// Filesystem inventories now include nested-repository working trees while
// excluding their `.git` metadata at every depth.
const FILESYSTEM_SNAPSHOT_SCHEMA_VERSION = "5";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const KILL_GRACE_MS = 5_000;
const EXIT_STDIO_GRACE_MS = 100;
const STDERR_CAP_BYTES = 4096;
const UNTRACKED_CHUNK_BYTES = 64 * 1024;

// Error classification (classifyGitError) matches against git's English
// error text. Without forcing the locale, a host running e.g. de_DE.UTF-8
// gets localized messages ("Kein Git-Repository...") that the classifier
// cannot recognize, silently degrading every failure to the generic
// git_command_failed bucket.
// A function, not a cached object: process.env (notably PATH) can change
// after this module is first imported, and every call must see the current
// value rather than a snapshot frozen at import time.
export function gitEnv() {
  return { ...process.env, LC_ALL: "C", LANG: "C" };
}

function snapshotError(code, message) {
  return { ok: false, error: { code, message } };
}

function classifyGitError(error) {
  if (error && error.code === "ENOENT") {
    return snapshotError(
      "git_unavailable",
      "git ist nicht ausführbar (ENOENT).",
    );
  }
  const stderr = typeof error?.stderr === "string" ? error.stderr : "";
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (
    /not a git repository/i.test(stderr) ||
    /not a git repository/i.test(message)
  ) {
    return snapshotError(
      "no_repository",
      "Kein Git-Repository in diesem Verzeichnis.",
    );
  }
  const detail = (stderr || message || "git-Kommando fehlgeschlagen").trim();
  return snapshotError(
    "git_command_failed",
    detail.length > STDERR_CAP_BYTES
      ? `${detail.slice(0, STDERR_CAP_BYTES)}…`
      : detail,
  );
}

function runGitSync(worktree, args, timeoutMs) {
  try {
    return {
      ok: true,
      value: execFileSync("git", args, {
        cwd: worktree,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: timeoutMs,
        env: gitEnv(),
      }),
    };
  } catch (error) {
    return classifyGitError(error);
  }
}

function nullSeparated(output) {
  return output.split("\0").filter(Boolean);
}

function resolveRepositoryRoot(worktree, timeoutMs, maxAttempts) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = runGitSync(
      worktree,
      ["rev-parse", "--show-toplevel"],
      timeoutMs,
    );
    if (result.ok) return { ok: true, value: resolve(result.value.trim()) };
    lastError = result;
  }
  return (
    lastError ??
    snapshotError(
      "unstable_workspace",
      `Repository-Root konnte nach ${maxAttempts} Versuchen nicht bestimmt werden.`,
    )
  );
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

/**
 * File metadata per changed path, as a plain sorted string — not a Git call at
 * all. `--name-status` alone cannot see a same-status content edit (a file
 * already modified getting modified again mid-capture is still just "M"),
 * and even `--numstat`/`--raw` miss same-line-count edits (numstat) or never
 * carry a real blob hash for the *working-tree* side of an unstaged diff
 * (raw reports it as `0000000`, confirmed empirically). A filesystem write
 * changes ctime even when an editor restores mtime. Include inode and mode
 * to detect atomic replacements and permission changes as well. Index-only
 * edits are covered separately by the index hash in collectCheapState().
 */
function contentStamp(worktree, paths) {
  const entries = paths.map((path) => {
    try {
      const stat = lstatSync(resolve(worktree, path), { bigint: true });
      return `${path}:${stat.mtimeNs}:${stat.ctimeNs}:${stat.size}:${stat.ino}:${stat.mode}`;
    } catch {
      return `${path}:missing`;
    }
  });
  return entries.sort().join("\n");
}

/**
 * The small, name-only Git calls a snapshot needs. Their output plus a
 * contentStamp() of every changed path and a streamed index hash doubles as
 * a generation stamp for mutation detection (see sameGeneration).
 */
async function collectCheapState(worktree, timeoutMs, signal) {
  let head = runGitSync(worktree, ["rev-parse", "HEAD"], timeoutMs);
  if (!head.ok && head.error.code === "git_command_failed") {
    const symbolic = runGitSync(
      worktree,
      ["symbolic-ref", "--quiet", "HEAD"],
      timeoutMs,
    );
    if (symbolic.ok) {
      // An absent branch ref is a valid unborn HEAD. A corrupt ref, a
      // missing commit object or any operational error must stay an error.
      try {
        execFileSync(
          "git",
          ["show-ref", "--verify", "--quiet", symbolic.value.trim()],
          {
            cwd: worktree,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
            timeout: timeoutMs,
            env: gitEnv(),
          },
        );
      } catch (error) {
        if (error.status === 1 && !error.stderr?.trim()) {
          head = { ok: true, value: `unborn:${symbolic.value.trim()}` };
        }
      }
    }
  }
  if (!head.ok) return head;
  const stagedRaw = runGitSync(
    worktree,
    ["diff", "--cached", "--name-status", "-z", "-M"],
    timeoutMs,
  );
  if (!stagedRaw.ok) return stagedRaw;
  const unstagedRaw = runGitSync(
    worktree,
    ["diff", "--name-status", "-z", "-M"],
    timeoutMs,
  );
  if (!unstagedRaw.ok) return unstagedRaw;
  const untrackedRaw = runGitSync(
    worktree,
    ["ls-files", "--others", "--exclude-standard", "--full-name", "-z"],
    timeoutMs,
  );
  if (!untrackedRaw.ok) return untrackedRaw;
  const indexPath = runGitSync(
    worktree,
    ["rev-parse", "--git-path", "index"],
    timeoutMs,
  );
  if (!indexPath.ok) return indexPath;
  let indexHash;
  try {
    indexHash = await hashFile(
      resolve(worktree, indexPath.value.trim()),
      signal,
    );
  } catch (error) {
    if (signal?.aborted) {
      return snapshotError(
        "git_command_failed",
        "Snapshot-Erfassung wurde abgebrochen (AbortSignal).",
      );
    }
    if (error.code === "ENOENT") indexHash = "missing";
    else return snapshotError("read_failed", "Git-Index ist nicht lesbar.");
  }

  let stagedStatus;
  let unstagedStatus;
  try {
    stagedStatus = parseNameStatus(stagedRaw.value);
    unstagedStatus = parseNameStatus(unstagedRaw.value);
  } catch (error) {
    return snapshotError(
      "internal_inconsistency",
      error instanceof Error ? error.message : String(error),
    );
  }

  const untracked = nullSeparated(untrackedRaw.value).sort();
  const changedPaths = [
    ...new Set([
      ...stagedStatus.changes.map((entry) => entry.path),
      ...unstagedStatus.changes.map((entry) => entry.path),
      ...stagedStatus.renames.flatMap(({ from, to }) => [from, to]),
      ...unstagedStatus.renames.flatMap(({ from, to }) => [from, to]),
      ...untracked,
    ]),
  ];

  return {
    ok: true,
    value: {
      head: head.value.trim(),
      stagedRaw: stagedRaw.value,
      unstagedRaw: unstagedRaw.value,
      untrackedRaw: untrackedRaw.value,
      contentStamp: contentStamp(worktree, changedPaths),
      indexHash,
      stagedStatus,
      unstagedStatus,
      untracked,
    },
  };
}

function sameGeneration(before, after) {
  return (
    before.head === after.head &&
    before.stagedRaw === after.stagedRaw &&
    before.unstagedRaw === after.unstagedRaw &&
    before.untrackedRaw === after.untrackedRaw &&
    before.contentStamp === after.contentStamp &&
    before.indexHash === after.indexHash
  );
}

/**
 * Hashes a Git subprocess's stdout chunk-by-chunk instead of returning it as
 * a materialized string/buffer — this is what actually removes the 1 MiB
 * `execFileSync` pipe limit that ENOBUFS'd on large diffs, not a raised
 * `maxBuffer`. Same process-group + two-stage kill choreography as
 * `extensions/shared/tracked-exec.ts`. Hashing the raw bytes directly (no
 * decode/encode roundtrip) keeps the digest byte-identical to the previous
 * `hash(execFileSync(..., {encoding:"utf8"}))` implementation, since git's
 * `--binary` patch format is already ASCII-safe (Base85 for binary hunks).
 */
function hashGitOutput(worktree, args, { timeoutMs, signal } = {}) {
  return new Promise((resolvePromise) => {
    let child;
    try {
      child = spawn("git", args, {
        cwd: worktree,
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
        env: gitEnv(),
      });
    } catch (error) {
      resolvePromise(classifyGitError(error));
      return;
    }

    const digest = createHash("sha256");
    let bytes = 0;
    let stderrText = "";
    let killed = false;
    let killReason;
    let exited = false;
    let settled = false;
    let exitCode = null;
    let exitSignal = null;
    let stdoutEnded = child.stdout === null;
    let stderrEnded = child.stderr === null;
    let terminationEscalationPending = false;
    let timeoutId;
    let killGraceId;
    let postExitId;

    const clearTimer = (timer) => {
      if (timer) clearTimeout(timer);
    };

    const killGroup = (sig) => {
      const pid = child.pid;
      if (!pid) return;
      if (process.platform === "win32") {
        if (sig === "SIGTERM") {
          try {
            spawn("taskkill", ["/F", "/T", "/PID", String(pid)], {
              stdio: "ignore",
              windowsHide: true,
            });
          } catch {
            // Best effort; a later process exit still finalizes the result.
          }
        }
        return;
      }
      try {
        process.kill(-pid, sig);
      } catch {
        try {
          process.kill(pid, sig);
        } catch {
          // Process group already exited.
        }
      }
    };

    const cleanup = () => {
      clearTimer(timeoutId);
      clearTimer(killGraceId);
      clearTimer(postExitId);
      timeoutId = undefined;
      killGraceId = undefined;
      postExitId = undefined;
      signal?.removeEventListener("abort", onAbort);
      child.removeListener("error", onError);
      child.removeListener("exit", onExit);
      child.removeListener("close", onClose);
      child.stdout?.removeListener("data", onStdoutData);
      child.stderr?.removeListener("data", onStderrData);
      child.stdout?.removeListener("end", onStdoutEnd);
      child.stderr?.removeListener("end", onStderrEnd);
    };

    const finalize = () => {
      if (settled) return;
      settled = true;
      cleanup();
      child.stdout?.destroy();
      child.stderr?.destroy();
      if (killed) {
        resolvePromise(
          snapshotError(
            "git_command_failed",
            `git ${args.join(" ")} wurde abgebrochen (${
              killReason === "timeout" ? "Timeout" : "Abort"
            }).`,
          ),
        );
        return;
      }
      if (exitCode !== 0 || exitSignal) {
        resolvePromise(
          snapshotError(
            "git_command_failed",
            (
              stderrText ||
              `git ${args.join(" ")} schlug fehl (exit=${exitCode}, signal=${exitSignal ?? "-"}).`
            ).trim(),
          ),
        );
        return;
      }
      if (!stdoutEnded || !stderrEnded) {
        killGroup("SIGKILL");
        resolvePromise(
          snapshotError(
            "git_command_failed",
            "Git-Ausgabe wurde nicht vollständig geschlossen; kein gültiger Patch-Hash.",
          ),
        );
        return;
      }
      resolvePromise({
        ok: true,
        value: { sha256: digest.digest("hex"), bytes },
      });
    };

    const armPostExitTimer = () => {
      if (!exited || settled || terminationEscalationPending) return;
      clearTimer(postExitId);
      postExitId = setTimeout(finalize, EXIT_STDIO_GRACE_MS);
    };
    const maybeFinalizeAfterExit = () => {
      if (settled || !exited || terminationEscalationPending) return;
      if (stdoutEnded && stderrEnded) finalize();
      else armPostExitTimer();
    };

    const onStdoutData = (chunk) => {
      digest.update(chunk);
      bytes += chunk.length;
      armPostExitTimer();
    };
    const onStderrData = (chunk) => {
      if (stderrText.length < STDERR_CAP_BYTES) {
        stderrText += chunk
          .toString("utf8")
          .slice(0, STDERR_CAP_BYTES - stderrText.length);
      }
      armPostExitTimer();
    };
    const onStdoutEnd = () => {
      stdoutEnded = true;
      maybeFinalizeAfterExit();
    };
    const onStderrEnd = () => {
      stderrEnded = true;
      maybeFinalizeAfterExit();
    };
    const onError = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolvePromise(classifyGitError(error));
    };
    const onExit = (code, sig) => {
      exited = true;
      exitCode = code;
      exitSignal = sig;
      maybeFinalizeAfterExit();
    };
    const onClose = (code, sig) => {
      if (!exited) {
        exited = true;
        exitCode = code;
        exitSignal = sig;
      }
      maybeFinalizeAfterExit();
    };

    const killProcess = (reason) => {
      if (killed || settled) return;
      killed = true;
      killReason = reason;
      killGroup("SIGTERM");
      if (process.platform === "win32") return;
      terminationEscalationPending = true;
      killGraceId = setTimeout(() => {
        killGraceId = undefined;
        terminationEscalationPending = false;
        killGroup("SIGKILL");
        armPostExitTimer();
        maybeFinalizeAfterExit();
      }, KILL_GRACE_MS);
    };

    const onAbort = () => killProcess("abort-signal");
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
    if (timeoutMs && timeoutMs > 0) {
      timeoutId = setTimeout(() => killProcess("timeout"), timeoutMs);
    }

    child.stdout?.on("data", onStdoutData);
    child.stderr?.on("data", onStderrData);
    child.stdout?.once("end", onStdoutEnd);
    child.stderr?.once("end", onStderrEnd);
    child.once("error", onError);
    child.once("exit", onExit);
    child.once("close", onClose);
  });
}

/**
 * Reads and hashes every untracked path. Never touches `execFileSync`, so it
 * cannot ENOBUFS — but a file that disappears mid-scan (a real race with an
 * external mutation, not a defect) is reported as `transient` so the caller
 * retries the whole snapshot instead of treating it as a permanent read
 * failure.
 */
async function readUntrackedContent(worktree, paths, options = {}) {
  const signal = options.signal;
  const results = [];
  for (const path of paths) {
    const absolute = resolve(worktree, path);
    const rel = relative(worktree, absolute);
    if (rel === ".." || rel.startsWith(`..${sep}`)) {
      return {
        ok: false,
        error: {
          code: "read_failed",
          message: `Untracked path liegt außerhalb des Workspace: ${path}`,
        },
      };
    }
    try {
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) {
        results.push({ path, sha256: hash(readlinkSync(absolute)) });
      } else if (stat.isFile()) {
        results.push({ path, sha256: await hashFile(absolute, signal) });
      } else if (stat.isDirectory()) {
        const gitMarker = resolve(absolute, ".git");
        let isNestedRepository = false;
        try {
          lstatSync(gitMarker);
          isNestedRepository = true;
        } catch {
          // A directory without its own `.git` marker is not a Git worktree.
        }
        if (isNestedRepository) {
          // Treat the nested worktree as one entry in the parent Git
          // fingerprint, but make that entry sensitive to changes anywhere
          // in its working tree. The filesystem inventory ignores `.git`
          // metadata, so `git status` inside the child cannot churn the
          // parent's identity through the child's index.
          const nested = await collectFilesystemSnapshot(absolute, options);
          if (!nested.ok) return nested;
          results.push({
            path,
            nestedWorkspaceFingerprint: nested.snapshot.fingerprint,
          });
          continue;
        }
        return {
          ok: false,
          error: {
            code: "read_failed",
            message: `Untracked-Verzeichnis kann nicht als Repository oder reguläres Verzeichnis inventarisiert werden: ${path}`,
          },
        };
      } else {
        return {
          ok: false,
          error: {
            code: "read_failed",
            message: `Untracked path ist weder reguläre Datei noch Symlink: ${path}`,
          },
        };
      }
    } catch (error) {
      if (signal?.aborted) {
        return {
          ok: false,
          error: {
            code: "git_command_failed",
            message: "Snapshot-Erfassung wurde abgebrochen (AbortSignal).",
          },
        };
      }
      if (error && error.code === "ENOENT") {
        return {
          ok: false,
          transient: true,
          error: {
            code: "unstable_workspace",
            message: `Untracked-Datei verschwand während der Erfassung: ${path}`,
          },
        };
      }
      return {
        ok: false,
        error: {
          code: "read_failed",
          message: `Untracked path nicht lesbar: ${path} (${
            error instanceof Error ? error.message : String(error)
          })`,
        },
      };
    }
  }
  return { ok: true, value: results };
}

function hashFile(absolute, signal) {
  return new Promise((resolvePromise, rejectPromise) => {
    const digest = createHash("sha256");
    const stream = createReadStream(absolute, {
      highWaterMark: UNTRACKED_CHUNK_BYTES,
    });
    const onAbort = () => stream.destroy(new Error("Snapshot-Abbruch"));
    if (signal?.aborted) {
      onAbort();
    } else {
      signal?.addEventListener("abort", onAbort, { once: true });
    }
    stream.on("data", (chunk) => digest.update(chunk));
    stream.once("error", (error) => {
      signal?.removeEventListener("abort", onAbort);
      rejectPromise(error);
    });
    stream.once("end", () => {
      signal?.removeEventListener("abort", onAbort);
      resolvePromise(digest.digest("hex"));
    });
  });
}

/** Whether `.git` exists in the worktree or any parent directory. */
function findGitMarker(worktree) {
  let directory = resolve(worktree);
  for (;;) {
    try {
      lstatSync(resolve(directory, ".git"));
      return true;
    } catch (error) {
      if (error?.code !== "ENOENT") return true;
      // Only a confirmed absence lets the probe continue towards the root.
    }
    const parent = resolve(directory, "..");
    if (parent === directory) return false;
    directory = parent;
  }
}

/**
 * Probe whether `worktree` belongs to a readable Git repository without
 * falling back to a potentially large filesystem inventory. A broken `.git`
 * marker and operational Git errors remain errors; only a genuine
 * non-repository is reported as `hasRepository: false`.
 */
export function probeGitRepository(worktree, options = {}) {
  const repositoryRoot = resolveRepositoryRoot(
    worktree,
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
  );
  if (repositoryRoot.ok) {
    return {
      ok: true,
      hasRepository: true,
      root: repositoryRoot.value,
    };
  }
  if (
    repositoryRoot.error.code === "no_repository" &&
    !findGitMarker(worktree)
  ) {
    return { ok: true, hasRepository: false };
  }
  return repositoryRoot;
}

async function collectFilesystemSnapshot(worktree, options = {}) {
  const root = resolve(worktree);
  const entries = [];
  const pending = [""];
  try {
    const workspaceRoot = await realpathAsync(root);
    const streamedHash = createHash("sha256");
    streamedHash.update(
      JSON.stringify({
        schemaVersion: FILESYSTEM_SNAPSHOT_SCHEMA_VERSION,
        vcs: "none",
        workspaceRoot,
        inventoryMode: "streamed",
      }),
    );
    let filesystemEntries = 0;
    let streaming = false;
    const configuredThreshold = options.filesystemStreamingThreshold;
    const softLimit =
      Number.isSafeInteger(configuredThreshold) && configuredThreshold >= 0
        ? configuredThreshold
        : 100_000;

    const encodeEntry = (entry) => JSON.stringify(entry);
    const hashEntry = (entry) => {
      // JSON escaping prevents literal newlines, so the newline is an
      // unambiguous record separator even when filenames contain punctuation.
      streamedHash.update(encodeEntry(entry));
      streamedHash.update("\n");
    };

    while (pending.length > 0) {
      if (options.signal?.aborted) {
        return snapshotError(
          "git_command_failed",
          "Snapshot-Erfassung wurde abgebrochen (AbortSignal).",
        );
      }
      const directory = pending.pop();
      const absolute = resolve(root, directory);
      const names = (await readdirAsync(absolute)).sort();
      for (const name of names) {
        if (name === ".git") continue;
        if (name === "node_modules") continue;
        const path = directory ? `${directory}/${name}` : name;
        const fullPath = resolve(root, path);
        const stat = await lstatAsync(fullPath, { bigint: true });
        const kind = stat.isSymbolicLink()
          ? "symlink"
          : stat.isDirectory()
            ? "directory"
            : stat.isFile()
              ? "file"
              : "other";
        const linkTarget =
          kind === "symlink" ? await readlinkAsync(fullPath) : "";
        const entry = [
          path,
          kind,
          stat.size.toString(),
          stat.mtimeNs.toString(),
          stat.ctimeNs.toString(),
          stat.mode.toString(),
          stat.ino.toString(),
          linkTarget,
          "",
        ];
        filesystemEntries += 1;
        if (!streaming && filesystemEntries <= softLimit) {
          entries.push(entry);
        } else {
          if (!streaming) {
            streaming = true;
            // Crossing the soft limit switches to a deterministic streaming
            // digest. The inventory is still complete; only the temporary
            // per-entry array is discarded to keep memory bounded.
            for (const previous of entries) hashEntry(previous);
            entries.length = 0;
          }
          hashEntry(entry);
        }
        if (kind === "directory") pending.push(path);
      }
    }
    let fingerprint;
    if (streaming) {
      fingerprint = hash(
        JSON.stringify({
          schemaVersion: FILESYSTEM_SNAPSHOT_SCHEMA_VERSION,
          vcs: "none",
          workspaceRoot,
          inventoryMode: "streamed",
          filesystemEntries,
          inventorySha256: streamedHash.digest("hex"),
        }),
      );
    } else {
      entries.sort((left, right) =>
        left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0,
      );
      fingerprint = hash(
        JSON.stringify({
          schemaVersion: FILESYSTEM_SNAPSHOT_SCHEMA_VERSION,
          vcs: "none",
          workspaceRoot,
          inventoryMode: "in-memory",
          entries,
        }),
      );
    }
    return {
      ok: true,
      snapshot: {
        schemaVersion: FILESYSTEM_SNAPSHOT_SCHEMA_VERSION,
        vcs: "none",
        workspaceRoot,
        head: "",
        staged: [],
        unstaged: [],
        untracked: [],
        renames: [],
        deletions: [],
        changedFiles: [],
        filesystemEntries,
        filesystemInventoryMode: streaming ? "streamed" : "in-memory",
        fingerprint,
      },
    };
  } catch (error) {
    return snapshotError(
      "read_failed",
      `Filesystem-Snapshot nicht lesbar: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function buildSnapshot(state, stagedPatch, unstagedPatch, untrackedContent) {
  const { stagedStatus, unstagedStatus, untracked, head } = state;
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
    stagedPatchSha256: stagedPatch.sha256,
    unstagedPatchSha256: unstagedPatch.sha256,
    untrackedContent,
  });
  return { ...snapshot, fingerprint: hash(fingerprintInput) };
}

/**
 * Return the one canonical, content-sensitive representation of a Git
 * workspace. It contains paths and hashes only; patches and file contents are
 * intentionally never returned to benchmark results.
 *
 * Content identity (SNAP-001): two workspace states are the same workspace
 * iff `head`, the sorted `staged`/`unstaged`/`untracked`/`renames`/
 * `deletions` lists, `stagedPatchSha256`, `unstagedPatchSha256` and
 * `untrackedContent` are all equal. `stagedPatchSha256`/`unstagedPatchSha256`
 * are SHA-256 digests of the raw byte stream of `git diff [--cached]
 * --no-ext-diff --no-textconv --binary -M` — both anti-conversion flags are
 * mandatory, not stylistic: without them a `.gitattributes` `textconv`/
 * `diff.external` driver can map two different blobs onto the same diff
 * text (or arbitrary driver-controlled output), letting the fingerprint
 * certify content equality that does not exist. Mode changes (chmod without
 * a content change) are covered by this same raw patch — `git diff` without
 * `--name-status` includes `old mode`/`new mode` lines — so no separate mode
 * field exists or is needed. Explicitly NOT part of identity: timestamps,
 * inode/mtime/ctime (used only by `contentStamp()` as a mutation-during-
 * capture signal, never hashed into the fingerprint) and absolute paths.
 * Determinism: `buildSnapshot()` JSON-serializes a fixed key order
 * (`schemaVersion, head, staged, unstaged, untracked, renames, deletions,
 * changedFiles, stagedPatchSha256, unstagedPatchSha256, untrackedContent`)
 * over arrays that are always sorted first (`staged`/`unstaged`/`deletions`
 * by `path`, `renames` by `` `${from}\0${to}` `` — `\0` is a safe separator
 * since git's `-z` output NUL-terminates paths, so a path can never contain
 * one). No code path may fall back to a bare status or filename hash without
 * the patch/content hashes above (that would silently widen what counts as
 * "unchanged").
 *
 * Never throws. Git workspaces use the content-sensitive Git snapshot above;
 * a missing repository or Git executable falls back to a filesystem inventory
 * with bounded temporary memory (excluding `.git` and `node_modules` at
 * every depth, including nested worktrees) — unless a top-level `.git` entry
 * exists that Git cannot read, which is reported as an error. Genuine read, race,
 * aborted command and parser failures return `{ ok: false, error: { code, message } }`.
 * See `docs/decisions/027-workspace-snapshot-content-identity.md`.
 */
export async function collectWorkspaceSnapshot(worktree, options = {}) {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const signal = options.signal;
  const repositoryRoot = resolveRepositoryRoot(
    worktree,
    timeoutMs,
    maxAttempts,
  );
  if (!repositoryRoot.ok) {
    if (
      repositoryRoot.error.code === "no_repository" &&
      findGitMarker(worktree)
    ) {
      // `.git` exists but Git sees no repository, so it is damaged. The
      // filesystem inventory skips `.git`, so falling back would silently stop
      // observing repository state instead of reporting the problem.
      return snapshotError(
        "git_command_failed",
        "Ein .git-Eintrag ist vorhanden, aber Git erkennt kein gültiges Repository (beschädigt?).",
      );
    }
    if (
      ["no_repository", "git_unavailable"].includes(repositoryRoot.error.code)
    ) {
      return collectFilesystemSnapshot(worktree, options);
    }
    return repositoryRoot;
  }
  // Retained across attempts so a persistent Git-side collection failure is
  // returned with its concrete category instead of a generic unstable result.
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (signal?.aborted) {
      return snapshotError(
        "git_command_failed",
        "Snapshot-Erfassung wurde abgebrochen (AbortSignal).",
      );
    }

    const before = await collectCheapState(
      repositoryRoot.value,
      timeoutMs,
      signal,
    );
    if (!before.ok) {
      // Not necessarily permanent — e.g. a concurrent git process briefly
      // holding index.lock — so retry within budget rather than failing the
      // whole snapshot on what may be a transient collision.
      lastError = before;
      continue;
    }
    // Test seam for mutation-during-capture testing (1.4): production
    // callers omit this. Runs between the "before" generation stamp and the
    // patch/untracked collection, so a test can deterministically mutate the
    // workspace exactly where a real race would land.
    await options.onAttemptState?.(attempt, before.value);

    // --no-ext-diff and --no-textconv are both required (SNAP-001): either
    // one alone still lets a .gitattributes-configured diff driver replace
    // the byte stream this hash is computed over, decoupling the fingerprint
    // from the actual blob content. See the content-identity note on
    // collectWorkspaceSnapshot above.
    const [stagedPatch, unstagedPatch] = await Promise.all([
      hashGitOutput(
        repositoryRoot.value,
        [
          "diff",
          "--cached",
          "--no-ext-diff",
          "--no-textconv",
          "--binary",
          "-M",
        ],
        { timeoutMs, signal },
      ),
      hashGitOutput(
        repositoryRoot.value,
        ["diff", "--no-ext-diff", "--no-textconv", "--binary", "-M"],
        {
          timeoutMs,
          signal,
        },
      ),
    ]);
    if (!stagedPatch.ok || !unstagedPatch.ok) {
      lastError = !stagedPatch.ok ? stagedPatch : unstagedPatch;
      if (signal?.aborted || lastError.error.code === "git_unavailable")
        return lastError;
      continue;
    }

    const untrackedResult = await readUntrackedContent(
      repositoryRoot.value,
      before.value.untracked,
      options,
    );
    if (!untrackedResult.ok) {
      if (untrackedResult.transient) {
        lastError = undefined;
        continue;
      }
      return snapshotError(
        untrackedResult.error.code,
        untrackedResult.error.message,
      );
    }

    const after = await collectCheapState(
      repositoryRoot.value,
      timeoutMs,
      signal,
    );
    if (!after.ok) {
      lastError = after;
      continue;
    }
    if (!sameGeneration(before.value, after.value)) {
      lastError = undefined;
      continue;
    }

    return {
      ok: true,
      snapshot: buildSnapshot(
        before.value,
        stagedPatch.value,
        unstagedPatch.value,
        untrackedResult.value,
      ),
    };
  }

  return (
    lastError ??
    snapshotError(
      "unstable_workspace",
      `Workspace änderte sich während der Snapshot-Erfassung (${maxAttempts} Versuche ausgeschöpft).`,
    )
  );
}
