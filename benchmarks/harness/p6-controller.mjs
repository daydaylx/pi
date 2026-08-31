/**
 * P6-TERRA-SUBAGENTS controller. Structurally mirrors p5-controller.mjs
 * (reuses its harness-generic `pinRuntimeRoles`/`scanForNetworkToolCalls`
 * directly, no duplication), with three differences:
 *
 * 1. No Pi settings.json overlay — this series intentionally runs Pi
 *    against the worktree's own default (fetched, unmodified) settings.json,
 *    which already pins main/investigator=gpt-5.6-terra@high,
 *    debugger=gpt-5.6-terra@max, verifier=claude-sonnet-5@max (the user's
 *    real production stack). Only the harness-neutral npm/node_modules link
 *    is applied (still needed for fixture tests).
 * 2. All four Pi roles (including verifier) are active — none disabled.
 * 3. `manifest.promptSuffix` is appended, identically, to the public prompt
 *    on both harnesses (see p6-manifest.json for the exact text) so neither
 *    side can ask an unanswerable clarifying question in single-shot mode.
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
import { pinRuntimeRoles, scanForNetworkToolCalls } from "./p5-controller.mjs";
import {
  agentEnvironment,
  loadPrivateTask,
  runPrivateEvaluator,
} from "./v2-private.mjs";
import { linkNpmNodeModules } from "./p5/worktree-setup.mjs";

function hash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

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
  throw new Error(`Unknown P6 harness '${harness}'.`);
}

export function validatePrivateP6Task(privateRoot, taskId) {
  const task = loadPrivateTask(privateRoot, taskId);
  if (task.metadata.seriesId !== "P6-TERRA-SUBAGENTS")
    throw new Error("Private task does not belong to P6-TERRA-SUBAGENTS.");
  return {
    taskId,
    evaluatorFingerprint: hash(task.metadata),
    inputFingerprint: task.metadata.inputFingerprint,
  };
}

/** No Pi settings overlay for P6 — only the harness-neutral npm link. */
function prepareP6Worktree({ root, reference, taskId }) {
  const prepared = prepareP4Worktree({ root, reference, taskId });
  try {
    linkNpmNodeModules(prepared.worktree, root);
  } catch (error) {
    disposeP4Worktree(prepared);
    throw error;
  }
  return prepared;
}

export function createP6Result({
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
      promptSuffix: manifest.promptSuffix,
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

export async function runP6Task({
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
      `P6 requires a controlled agent launcher for harness '${run.harness}'.`,
    );
  const expectedRoles = expectedRolesFor(manifest, run.harness);
  if (run.harness === "pi")
    assertPinnedModelsAvailable(expectedRoles, availableModels);
  const privateTask = validatePrivateP6Task(privateRoot, run.task);
  const prepared = prepareP6Worktree({
    root,
    reference: manifest.reference,
    taskId: run.task,
  });
  try {
    const publicPrompt = readFileSync(prepared.promptPath, "utf8");
    const prompt = `${publicPrompt}${manifest.promptSuffix}`;
    // The stored promptFingerprint covers the FULL text actually sent
    // (public prompt + suffix) — the fingerprint is only meaningful if it
    // matches what the agent really received.
    const promptFingerprint = createHash("sha256").update(prompt).digest("hex");

    const launch = await launchAgent({
      worktree: prepared.worktree,
      prompt,
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
    return createP6Result({
      manifest,
      run,
      promptFingerprint,
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
