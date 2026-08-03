/**
 * P4 controller primitives: isolated worktrees, private evaluation and strict
 * role pinning. It deliberately never exposes a private task path to Pi.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import {
  agentEnvironment,
  loadPrivateTask,
  runPrivateEvaluator,
} from "./v2-private.mjs";
import {
  countSubagentToolCalls,
  isVariantViolation,
  subagentSpawnCap,
} from "./subagent-variant.mjs";

function hash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function promptPath(root, taskId) {
  const candidate = resolve(
    root,
    "benchmarks",
    "v2",
    "tasks",
    taskId,
    "PROMPT.md",
  );
  if (!candidate.startsWith(`${resolve(root)}${"/"}`) || !existsSync(candidate))
    throw new Error("P4 public task prompt is unavailable.");
  return candidate;
}

/**
 * Create an agent worktree from the fixed commit and remove historic hints.
 *
 * Uses an independent shallow fetch (git init + fetch --depth 1 + checkout)
 * rather than `git worktree add`. A worktree shares the parent repository's
 * .git object database, so `git log`/`git show` inside it could still reach
 * every commit ever made, including ones after `reference` and historic
 * TASK.md solution hints outside benchmarks/tasks/ (P0-05). A depth-1 fetch
 * from a local `file://` URL gives a repository whose object database
 * genuinely contains only the one requested commit (verified: `git log`
 * shows exactly one entry, and `git cat-file -e` on an unrelated commit
 * fails with "not a valid object name" rather than merely being hidden by
 * ref visibility).
 */
export function prepareP4Worktree({ root, reference, taskId }) {
  const publicPrompt = promptPath(root, taskId); // validate before mutation
  const base = mkdtempSync(join(tmpdir(), "pi-p4-worktree-"));
  const worktree = join(base, "source");
  try {
    mkdirSync(worktree, { recursive: true });
    git(worktree, ["init", "--quiet"]);
    git(worktree, [
      "fetch",
      "--quiet",
      "--depth",
      "1",
      `file://${root}`,
      reference,
    ]);
    git(worktree, ["checkout", "--quiet", "FETCH_HEAD"]);
    const actualReference = git(worktree, ["rev-parse", "HEAD"]).trim();
    if (actualReference !== reference) {
      throw new Error(
        "P4 worktree did not resolve to the required reference commit.",
      );
    }
    // P3 task descriptions include solution hints. They are historical data,
    // not an input to any P4 agent. The P4 prompt is passed in-memory only.
    const historicTasks = join(worktree, "benchmarks", "tasks");
    if (existsSync(historicTasks))
      rmSync(historicTasks, { recursive: true, force: true });
    if (findTaskDescriptions(worktree).length)
      throw new Error("P4 worktree still contains a task description.");
    // Some migrated tasks reference files that did not exist yet at
    // `reference` (see benchmarks/tasks/<id>/fixture/, the pre-P4 overlay
    // reset-task.sh applied). Restore that overlay so the prompt's file
    // references resolve (P0-06).
    const fixtureSource = resolve(
      root,
      "benchmarks",
      "tasks",
      taskId,
      "fixture",
    );
    if (existsSync(fixtureSource)) {
      cpSync(fixtureSource, join(worktree, "benchmark-fixture"), {
        recursive: true,
      });
    }
    // Both changes above (the historic-tasks removal and the fixture
    // restore) are P4 setup, not agent work, so they are folded into one
    // commit here rather than left staged or unstaged. inspectAgentChanges
    // below now inspects staged changes and untracked files too (P0-07);
    // without this commit, both of the above would permanently show up as
    // an "agent change" on every single run regardless of what the agent
    // actually did.
    git(worktree, ["add", "-A"]);
    const setupDiff = git(worktree, ["diff", "--cached", "--name-only"]);
    if (setupDiff.trim().length > 0) {
      git(worktree, [
        "-c",
        "user.email=p4-benchmark@localhost",
        "-c",
        "user.name=P4 Benchmark Setup",
        "commit",
        "--quiet",
        "-m",
        "P4 setup: remove historic task hints and restore fixture overlay",
      ]);
    }
    return {
      base,
      worktree,
      promptPath: publicPrompt,
      promptFingerprint: createHash("sha256")
        .update(readFileSync(publicPrompt))
        .digest("hex"),
    };
  } catch (error) {
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

// No `git worktree remove` step: prepareP4Worktree no longer registers a
// worktree against the parent repository, so plain removal is sufficient
// and there is nothing left to unregister there.
export function disposeP4Worktree({ base, worktree }) {
  if (
    !base.startsWith(`${tmpdir()}${"/"}`) ||
    relative(base, worktree).startsWith("..")
  )
    throw new Error("Refusing to dispose an unrecognised P4 worktree.");
  rmSync(base, { recursive: true, force: true });
}

export function pinRuntimeRoles(manifestRoles, resolvedRoles) {
  const result = {};
  for (const [role, expected] of Object.entries(manifestRoles)) {
    if (expected.enabled === false) {
      result[role] = { enabled: false };
      continue;
    }
    const actual = resolvedRoles?.[role];
    if (
      !actual ||
      actual.model !== expected.model ||
      actual.thinking !== expected.thinking
    ) {
      throw new Error(
        `P4 runtime role '${role}' differs from the manifest pin.`,
      );
    }
    result[role] = {
      enabled: true,
      model: actual.model,
      thinking: actual.thinking,
      ...(actual.provider ? { provider: actual.provider } : {}),
    };
  }
  for (const role of Object.keys(resolvedRoles ?? {}))
    if (!(role in manifestRoles))
      throw new Error(`P4 runtime reported an unpinned role '${role}'.`);
  return result;
}

/** Fail before a run if Pi cannot resolve every explicitly pinned model. */
export function assertPinnedModelsAvailable(manifestRoles, availableModels) {
  if (!Array.isArray(availableModels))
    throw new Error("P4 requires the runtime's resolved available-model list.");
  for (const [role, pin] of Object.entries(manifestRoles)) {
    if (pin.enabled === false) continue;
    if (!availableModels.includes(pin.model))
      throw new Error(`P4 pinned model for '${role}' is unavailable.`);
  }
  return true;
}

/** A subagent record must preserve its role, pin and main-run relationship. */
export function validateRoleHistory(history, manifestRoles, parentRunId) {
  if (!Array.isArray(history))
    throw new Error("P4 runtime did not return role history.");
  return history.map((entry) => {
    const pin = manifestRoles[entry?.role];
    if (
      !pin ||
      pin.enabled === false ||
      entry.parentRunId !== parentRunId ||
      entry.model !== pin.model ||
      entry.thinking !== pin.thinking
    ) {
      throw new Error(
        "P4 subagent history differs from the pinned role configuration.",
      );
    }
    return {
      role: entry.role,
      model: entry.model,
      thinking: entry.thinking,
      parentRunId: entry.parentRunId,
      ...(entry.durationMs === undefined
        ? {}
        : { durationMs: entry.durationMs }),
      ...(entry.tokens === undefined ? {} : { tokens: entry.tokens }),
    };
  });
}

// P0-07: staged changes and new untracked files used to be entirely
// invisible here (only unstaged diff against tracked files was inspected),
// so an agent's staged-but-not-committed edit, or a new file it never
// staged, would not show up in the result's diff/changedFiles at all.
export function inspectAgentChanges(worktree) {
  const unstagedDiff = git(worktree, ["diff", "--no-ext-diff", "--binary"]);
  const stagedDiff = git(worktree, [
    "diff",
    "--cached",
    "--no-ext-diff",
    "--binary",
  ]);
  const status = git(worktree, [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  ]);
  const unstagedFiles = git(worktree, [
    "diff",
    "--no-ext-diff",
    "--name-only",
  ])
    .split("\n")
    .filter(Boolean);
  const stagedFiles = git(worktree, [
    "diff",
    "--cached",
    "--no-ext-diff",
    "--name-only",
  ])
    .split("\n")
    .filter(Boolean);
  const untrackedFiles = status
    .split("\n")
    .filter((line) => line.startsWith("?? "))
    .map((line) => line.slice(3));
  const changedFiles = [
    ...new Set([...unstagedFiles, ...stagedFiles, ...untrackedFiles]),
  ].sort();
  const visibleTestChanges = changedFiles.filter((path) =>
    /(^|\/)(?:test|tests|__tests__|spec)(?:\/|\.|$)/i.test(path),
  );
  const benchmarkChanges = changedFiles.filter((path) =>
    /(^|\/)(?:bench|benchmark)(?:\/|\.|$)/i.test(path),
  );
  return {
    diffFingerprint: createHash("sha256")
      .update(`${unstagedDiff}\0${stagedDiff}\0${status}`)
      .digest("hex"),
    changedFiles,
    visibleTestChanges,
    benchmarkChanges,
  };
}

export function createP4Result({
  manifest,
  run,
  promptFingerprint,
  resolvedRoles,
  evaluator,
  inputFingerprint,
  sessionMetrics,
  diff,
  variantViolation,
}) {
  pinRuntimeRoles(manifest.roles, resolvedRoles);
  const configFingerprint = hash({
    manifest: {
      seriesId: manifest.seriesId,
      reference: manifest.reference,
      roles: manifest.roles,
      run,
    },
    promptFingerprint,
  });
  return {
    schemaVersion: "2.0.0",
    seriesId: manifest.seriesId,
    runId: run.id,
    stackMode: run.stackMode,
    reference: manifest.reference,
    configFingerprint,
    promptFingerprint,
    resolvedRoles,
    evaluator,
    inputFingerprint,
    sessionMetrics,
    diff,
    ...(run.variant ? { variant: run.variant, variantViolation } : {}),
  };
}

/** Verify the private task before an agent starts, without returning its path. */
export function validatePrivateP4Task(privateRoot, taskId) {
  const task = loadPrivateTask(privateRoot, taskId);
  if (task.metadata.seriesId !== "P4")
    throw new Error("Private task does not belong to P4.");
  return {
    taskId,
    evaluatorFingerprint: hash(task.metadata),
    inputFingerprint: task.metadata.inputFingerprint,
  };
}

/**
 * Execute one P4 run. `launchAgent` belongs to the runtime integration; it is
 * handed only the public prompt, isolated worktree and scrubbed environment.
 */
export async function runP4Task({
  root,
  manifest,
  run,
  privateRoot,
  availableModels,
  launchAgent,
}) {
  if (typeof launchAgent !== "function")
    throw new Error("P4 requires a controlled agent launcher.");
  assertPinnedModelsAvailable(manifest.roles, availableModels);
  const privateTask = validatePrivateP4Task(privateRoot, run.task);
  const prepared = prepareP4Worktree({
    root,
    reference: manifest.reference,
    taskId: run.task,
  });
  try {
    const launch = await launchAgent({
      worktree: prepared.worktree,
      prompt: readFileSync(prepared.promptPath, "utf8"),
      env: agentEnvironment(process.env),
      run: { id: run.id, stackMode: run.stackMode },
    });
    const resolvedRoles = pinRuntimeRoles(
      manifest.roles,
      launch?.resolvedRoles,
    );
    const roleHistory = validateRoleHistory(
      launch?.roleHistory ?? [],
      manifest.roles,
      run.id,
    );
    const evaluator = runPrivateEvaluator({
      root: privateRoot,
      taskId: run.task,
      worktree: prepared.worktree,
    });
    const diff = inspectAgentChanges(prepared.worktree);
    // Enforcing the with/without-subagent A/B variant requires knowing how
    // many real subagent calls happened; launchAgent is the only caller that
    // knows the session path, so it reports it back here rather than P4
    // reaching into the runtime integration's own state.
    let variantViolation;
    if (run.variant) {
      if (typeof launch?.sessionPath !== "string") {
        throw new Error(
          "P4 requires launchAgent to report sessionPath for a variant run.",
        );
      }
      const subagentCalls = countSubagentToolCalls(launch.sessionPath);
      const subagentCap = subagentSpawnCap(prepared.worktree);
      variantViolation = isVariantViolation(
        run.variant,
        subagentCalls,
        subagentCap,
      );
    }
    return createP4Result({
      manifest,
      run,
      promptFingerprint: prepared.promptFingerprint,
      resolvedRoles,
      evaluator: {
        ...evaluator,
        visibleTestChanges: diff.visibleTestChanges,
        benchmarkChanges: diff.benchmarkChanges,
      },
      inputFingerprint: privateTask.inputFingerprint ?? "unknown",
      sessionMetrics: { ...(launch?.sessionMetrics ?? {}), roleHistory },
      diff,
      variantViolation,
    });
  } finally {
    disposeP4Worktree(prepared);
  }
}
