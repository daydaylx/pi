/**
 * P4 controller primitives: isolated worktrees, private evaluation and strict
 * role pinning. It deliberately never exposes a private task path to Pi.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { loadPrivateTask } from "./v2-private.mjs";

function hash(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

function git(root, args) { return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); }

export function promptPath(root, taskId) {
  const candidate = resolve(root, "benchmarks", "v2", "tasks", taskId, "PROMPT.md");
  if (!candidate.startsWith(`${resolve(root)}${"/"}`) || !existsSync(candidate)) throw new Error("P4 public task prompt is unavailable.");
  return candidate;
}

/** Create an agent worktree from the fixed commit and remove historic hints. */
export function prepareP4Worktree({ root, reference, taskId }) {
  const publicPrompt = promptPath(root, taskId); // validate before mutation
  const base = mkdtempSync(join(tmpdir(), "pi-p4-worktree-"));
  const worktree = join(base, "source");
  try {
    git(root, ["worktree", "add", "--detach", worktree, reference]);
    // P3 task descriptions include solution hints. They are historical data,
    // not an input to any P4 agent. The P4 prompt is passed in-memory only.
    const historicTasks = join(worktree, "benchmarks", "tasks");
    if (existsSync(historicTasks)) rmSync(historicTasks, { recursive: true, force: true });
    if (findTaskDescriptions(worktree).length) throw new Error("P4 worktree still contains a task description.");
    return { base, worktree, promptPath: publicPrompt, promptFingerprint: createHash("sha256").update(readFileSync(publicPrompt)).digest("hex") };
  } catch (error) {
    try { git(root, ["worktree", "remove", "--force", worktree]); } catch { /* not added */ }
    rmSync(base, { recursive: true, force: true });
    throw error;
  }
}

function findTaskDescriptions(directory) {
  if (!existsSync(directory)) return [];
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const child = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...findTaskDescriptions(child));
    else if (entry.isFile() && entry.name === "TASK.md") found.push(child);
  }
  return found;
}

export function disposeP4Worktree({ root, base, worktree }) {
  if (!base.startsWith(`${tmpdir()}${"/"}`) || relative(base, worktree).startsWith("..")) throw new Error("Refusing to dispose an unrecognised P4 worktree.");
  try { git(root, ["worktree", "remove", "--force", worktree]); } finally { rmSync(base, { recursive: true, force: true }); }
}

export function pinRuntimeRoles(manifestRoles, resolvedRoles) {
  const result = {};
  for (const [role, expected] of Object.entries(manifestRoles)) {
    if (expected.enabled === false) { result[role] = { enabled: false }; continue; }
    const actual = resolvedRoles?.[role];
    if (!actual || actual.model !== expected.model || actual.thinking !== expected.thinking) {
      throw new Error(`P4 runtime role '${role}' differs from the manifest pin.`);
    }
    result[role] = { enabled: true, model: actual.model, thinking: actual.thinking, ...(actual.provider ? { provider: actual.provider } : {}) };
  }
  for (const role of Object.keys(resolvedRoles ?? {})) if (!(role in manifestRoles)) throw new Error(`P4 runtime reported an unpinned role '${role}'.`);
  return result;
}

export function createP4Result({ manifest, run, promptFingerprint, resolvedRoles, evaluator, inputFingerprint, sessionMetrics, diff }) {
  const roles = pinRuntimeRoles(manifest.roles, resolvedRoles);
  const configFingerprint = hash({ manifest: { seriesId: manifest.seriesId, reference: manifest.reference, roles: manifest.roles, run }, promptFingerprint });
  return {
    schemaVersion: "2.0.0", seriesId: manifest.seriesId, runId: run.id, stackMode: run.stackMode,
    reference: manifest.reference, configFingerprint, promptFingerprint, resolvedRoles,
    evaluator, inputFingerprint,
    sessionMetrics, diff,
  };
}

/** Verify the private task before an agent starts, without returning its path. */
export function validatePrivateP4Task(privateRoot, taskId) {
  const task = loadPrivateTask(privateRoot, taskId);
  if (task.metadata.seriesId !== "P4") throw new Error("Private task does not belong to P4.");
  return { taskId, evaluatorFingerprint: hash(task.metadata), inputFingerprint: task.metadata.inputFingerprint };
}
