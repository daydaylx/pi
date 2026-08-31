/**
 * P5-LUNA-HARNESS controller: dispatches a run to the Pi or Codex launcher
 * based on `run.harness`, while reusing P4's worktree isolation, role-pinning
 * enforcement and private-evaluator boundary unmodified (see p4-controller.mjs,
 * v2-private.mjs — both are already harness-neutral).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  assertPinnedModelsAvailable,
  disposeP4Worktree,
  inspectAgentChanges,
  prepareP4Worktree,
  validateRoleHistory,
} from "./p4-controller.mjs";
import {
  agentEnvironment,
  loadPrivateTask,
  runPrivateEvaluator,
} from "./v2-private.mjs";
import { prepareP5Worktree } from "./p5/worktree-setup.mjs";

function hash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/**
 * P5's own role-pinning check — deliberately NOT p4-controller.mjs's
 * `pinRuntimeRoles`, whose real-world behavior surfaced only once P5 first
 * ran a genuine (non-stubbed) agent turn: it requires every manifest role
 * with `enabled !== false` to appear in `resolvedRoles`, i.e. it treats
 * "pinned" as "must have been invoked this run". That is wrong for
 * investigator/debugger — Pi's own delegation is conditional (see
 * AGENTS.md's delegation criteria), so a run that never delegates is a
 * legitimate, honest outcome (0 subagent calls), not a fairness violation.
 * `main` is the only role that is always invoked and therefore always
 * required. A role that WAS invoked must still match its pin exactly.
 * Idempotent on its own sanitized output (`createP5Result` re-validates).
 */
export function pinRuntimeRoles(manifestRoles, resolvedRoles) {
  const result = {};
  for (const [role, expected] of Object.entries(manifestRoles)) {
    if (expected.enabled === false) {
      result[role] = { enabled: false };
      continue;
    }
    const actual = resolvedRoles?.[role];
    const hasModelData = Boolean(actual && typeof actual.model === "string");
    if (role === "main" && !hasModelData) {
      throw new Error(
        "P5 runtime role 'main' differs from the manifest pin (main must always be invoked).",
      );
    }
    if (!hasModelData) {
      result[role] = { enabled: true, invoked: false };
      continue;
    }
    if (
      actual.model !== expected.model ||
      actual.thinking !== expected.thinking
    ) {
      throw new Error(
        `P5 runtime role '${role}' differs from the manifest pin.`,
      );
    }
    result[role] = {
      enabled: true,
      invoked: true,
      model: actual.model,
      thinking: actual.thinking,
      ...(actual.provider ? { provider: actual.provider } : {}),
    };
  }
  for (const role of Object.keys(resolvedRoles ?? {}))
    if (!(role in manifestRoles))
      throw new Error(`P5 runtime reported an unpinned role '${role}'.`);
  return result;
}

/** The role/model shape `pinRuntimeRoles`/`validateRoleHistory` expect, per harness. */
export function expectedRolesFor(manifest, harness) {
  if (harness === "pi") return manifest.harnesses.pi.roles;
  if (harness === "codex") {
    return {
      main: {
        model: manifest.harnesses.codex.model,
        thinking: manifest.harnesses.codex.reasoningEffort,
      },
    };
  }
  throw new Error(`Unknown P5 harness '${harness}'.`);
}

/** Verify the private task before an agent starts, without returning its path. */
export function validatePrivateP5Task(privateRoot, taskId) {
  const task = loadPrivateTask(privateRoot, taskId);
  if (task.metadata.seriesId !== "P5-LUNA-HARNESS")
    throw new Error("Private task does not belong to P5-LUNA-HARNESS.");
  return {
    taskId,
    evaluatorFingerprint: hash(task.metadata),
    inputFingerprint: task.metadata.inputFingerprint,
  };
}

export function createP5Result({
  manifest,
  run,
  promptFingerprint,
  resolvedRoles,
  evaluator,
  inputFingerprint,
  automaticMetrics,
  diff,
  networkToolCallsObserved,
}) {
  pinRuntimeRoles(expectedRolesFor(manifest, run.harness), resolvedRoles);
  const configFingerprint = hash({
    manifest: {
      seriesId: manifest.seriesId,
      reference: manifest.reference,
      harness: run.harness,
      roles: expectedRolesFor(manifest, run.harness),
      run,
    },
    promptFingerprint,
  });
  return {
    schemaVersion: "1.0.0",
    seriesId: manifest.seriesId,
    runId: run.id,
    harness: run.harness,
    stackMode: run.stackMode,
    reference: manifest.reference,
    configFingerprint,
    promptFingerprint,
    resolvedRoles,
    evaluator,
    inputFingerprint,
    automaticMetrics,
    diff,
    networkToolCallsObserved: networkToolCallsObserved ?? null,
  };
}

// Coarse, honestly-labeled mitigation for the Pi/Codex network-isolation
// asymmetry (see METHODOLOGY.md): Codex's workspace-write sandbox blocks
// network at the OS level; Pi has no equivalent, so every run's raw trace is
// scanned for shell-like network tool invocations instead of assuming
// parity. False positives (e.g. a file merely mentioning "curl" in a
// comment) are possible; this is a coarse signal, not a security boundary.
export function scanForNetworkToolCalls(tracePath) {
  if (!tracePath) return null;
  let raw;
  try {
    raw = readFileSync(tracePath, "utf8");
  } catch {
    return null;
  }
  const pattern = /\b(curl|wget|nc|ssh)\b/g;
  let count = 0;
  for (const line of raw.split("\n")) {
    if (pattern.test(line)) count += 1;
    pattern.lastIndex = 0;
  }
  return count;
}

/**
 * Execute one P5 run for either harness. `launchAgentByHarness` maps
 * `"pi"`/`"codex"` to their respective launchAgent implementations;
 * `collectPiMetrics`/`collectCodexMetrics` produce the harness-neutral
 * `automaticMetrics` object for their side.
 */
export async function runP5Task({
  root,
  manifest,
  run,
  privateRoot,
  availableModels,
  launchAgentByHarness,
  collectPiMetrics,
  collectCodexMetrics,
}) {
  const launchAgent = launchAgentByHarness?.[run.harness];
  if (typeof launchAgent !== "function")
    throw new Error(
      `P5 requires a controlled agent launcher for harness '${run.harness}'.`,
    );
  const expectedRoles = expectedRolesFor(manifest, run.harness);
  if (run.harness === "pi")
    assertPinnedModelsAvailable(expectedRoles, availableModels);
  const privateTask = validatePrivateP5Task(privateRoot, run.task);
  const prepared = prepareP5Worktree({
    prepareWorktree: prepareP4Worktree,
    disposeWorktree: disposeP4Worktree,
    root,
    reference: manifest.reference,
    taskId: run.task,
    harness: run.harness,
    manifest,
  });
  try {
    const launch = await launchAgent({
      worktree: prepared.worktree,
      prompt: readFileSync(prepared.promptPath, "utf8"),
      env: agentEnvironment(process.env),
      run: { id: run.id, stackMode: run.stackMode },
    });
    const resolvedRoles = pinRuntimeRoles(expectedRoles, launch?.resolvedRoles);
    const roleHistory = validateRoleHistory(
      launch?.roleHistory ?? [],
      expectedRoles,
      run.id,
    );
    const evaluator = runPrivateEvaluator({
      root: privateRoot,
      taskId: run.task,
      worktree: prepared.worktree,
    });
    const diff = inspectAgentChanges(prepared.worktree);
    const automaticMetrics =
      run.harness === "pi"
        ? await collectPiMetrics({
            taskId: run.task,
            sessionPath: launch.sessionPath,
            subagentCalls: roleHistory.length,
          })
        : await collectCodexMetrics({
            taskId: run.task,
            rolloutPath: launch.sessionPath,
            worktree: prepared.worktree,
            launchSessionMetrics: launch.sessionMetrics,
          });
    return createP5Result({
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
      automaticMetrics,
      diff,
      networkToolCallsObserved: scanForNetworkToolCalls(launch.sessionPath),
    });
  } finally {
    disposeP4Worktree(prepared);
  }
}
