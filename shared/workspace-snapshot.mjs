import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import {
  closeSync,
  lstatSync,
  openSync,
  readSync,
  readlinkSync,
} from "node:fs";
import { relative, resolve, sep } from "node:path";

export const WORKSPACE_SNAPSHOT_SCHEMA_VERSION = "1";

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
function gitEnv() {
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
 * mtime+size per changed path, as a plain sorted string — not a Git call at
 * all. `--name-status` alone cannot see a same-status content edit (a file
 * already modified getting modified again mid-capture is still just "M"),
 * and even `--numstat`/`--raw` miss same-line-count edits (numstat) or never
 * carry a real blob hash for the *working-tree* side of an unstaged diff
 * (raw reports it as `0000000`, confirmed empirically). A filesystem write
 * bumps mtime essentially always, on any real edit, staged or unstaged —
 * and stat() is cheap and proportional to the number of changed paths, not
 * diff size, same as the other cheap calls here.
 */
function contentStamp(worktree, paths) {
  const entries = paths.map((path) => {
    try {
      const stat = lstatSync(resolve(worktree, path));
      return `${path}:${stat.mtimeMs}:${stat.size}`;
    } catch {
      return `${path}:missing`;
    }
  });
  return entries.sort().join("\n");
}

/**
 * The cheap, name-only Git calls a snapshot needs. Never observed to
 * approach the 1 MiB pipe limit (unlike the two full-patch calls below), so
 * these stay on execFileSync. Their raw text, plus a contentStamp() of every
 * changed path, doubles as a generation stamp for mutation detection (see
 * sameGeneration).
 */
function collectCheapState(worktree, timeoutMs) {
  const head = runGitSync(worktree, ["rev-parse", "HEAD"], timeoutMs);
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
    ["ls-files", "--others", "--exclude-standard", "-z"],
    timeoutMs,
  );
  if (!untrackedRaw.ok) return untrackedRaw;

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
    before.contentStamp === after.contentStamp
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

function hashFileSync(absolute) {
  const fd = openSync(absolute, "r");
  try {
    const digest = createHash("sha256");
    const buffer = Buffer.alloc(UNTRACKED_CHUNK_BYTES);
    let bytesRead;
    // eslint-disable-next-line no-cond-assign
    while ((bytesRead = readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      digest.update(
        bytesRead === buffer.length ? buffer : buffer.subarray(0, bytesRead),
      );
    }
    return digest.digest("hex");
  } finally {
    closeSync(fd);
  }
}

/**
 * Reads and hashes every untracked path. Never touches `execFileSync`, so it
 * cannot ENOBUFS — but a file that disappears mid-scan (a real race with an
 * external mutation, not a defect) is reported as `transient` so the caller
 * retries the whole snapshot instead of treating it as a permanent read
 * failure.
 */
function readUntrackedContent(worktree, paths) {
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
        results.push({ path, sha256: hashFileSync(absolute) });
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
 * Never throws — every failure mode (no repository, git unavailable, a
 * failed/aborted git command, an unreadable path, a workspace that kept
 * changing across the retry budget, or a parser contradiction) comes back as
 * `{ ok: false, error: { code, message } }` so every caller can react
 * explicitly instead of a bare exception forcing an implicit, inconsistent
 * fallback per call site.
 */
export async function collectWorkspaceSnapshot(worktree, options = {}) {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const signal = options.signal;
  // Retained across attempts so that exhausting the budget on a persistent
  // (non-transient) collectCheapState failure — e.g. genuinely no
  // repository — still reports that specific, nameable cause instead of
  // masking it behind a generic unstable_workspace.
  let lastCheapStateError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (signal?.aborted) {
      return snapshotError(
        "git_command_failed",
        "Snapshot-Erfassung wurde abgebrochen (AbortSignal).",
      );
    }

    const before = collectCheapState(worktree, timeoutMs);
    if (!before.ok) {
      // Not necessarily permanent — e.g. a concurrent git process briefly
      // holding index.lock — so retry within budget rather than failing the
      // whole snapshot on what may be a transient collision.
      lastCheapStateError = before;
      continue;
    }
    // Test seam for mutation-during-capture testing (1.4): production
    // callers omit this. Runs between the "before" generation stamp and the
    // patch/untracked collection, so a test can deterministically mutate the
    // workspace exactly where a real race would land.
    await options.onAttemptState?.(attempt, before.value);

    const [stagedPatch, unstagedPatch] = await Promise.all([
      hashGitOutput(
        worktree,
        ["diff", "--cached", "--no-ext-diff", "--binary", "-M"],
        { timeoutMs, signal },
      ),
      hashGitOutput(worktree, ["diff", "--no-ext-diff", "--binary", "-M"], {
        timeoutMs,
        signal,
      }),
    ]);
    if (!stagedPatch.ok) return stagedPatch;
    if (!unstagedPatch.ok) return unstagedPatch;

    const untrackedResult = readUntrackedContent(
      worktree,
      before.value.untracked,
    );
    if (!untrackedResult.ok) {
      if (untrackedResult.transient) continue;
      return snapshotError(
        untrackedResult.error.code,
        untrackedResult.error.message,
      );
    }

    const after = collectCheapState(worktree, timeoutMs);
    if (!after.ok) {
      lastCheapStateError = after;
      continue;
    }
    if (!sameGeneration(before.value, after.value)) continue;

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
    lastCheapStateError ??
    snapshotError(
      "unstable_workspace",
      `Workspace änderte sich während der Snapshot-Erfassung (${maxAttempts} Versuche ausgeschöpft).`,
    )
  );
}
