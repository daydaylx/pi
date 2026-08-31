/**
 * P6 CLI commands: validate, run, summarize. Mirrors benchmarks/harness/p5/cli.mjs,
 * reusing the harness-generic launch-pi.mjs/launch-codex.mjs/collect-*-metrics.mjs/
 * models.mjs/agent.mjs from p5/ unchanged (none of them hardcode the Luna model
 * or the Core-Parity role shape — they read whatever the manifest passes in).
 */
import { existsSync } from "node:fs";
import { loadP6Manifest, validateP6Manifest } from "../p6-manifest.mjs";
import { runP6Task } from "../p6-controller.mjs";
import { privateRoot as resolvePrivateRoot } from "../v2-private.mjs";
import { isOfflineTest } from "../p5/agent.mjs";
import { SOURCE_ROOT } from "../p5/config.mjs";
import { collectCodexMetrics } from "../p5/collect-codex-metrics.mjs";
import { collectPiMetrics } from "../p5/collect-pi-metrics.mjs";
import { createLaunchCodexAgent } from "../p5/launch-codex.mjs";
import { createLaunchPiAgent } from "../p5/launch-pi.mjs";
import { listAvailableModels } from "../p5/models.mjs";
import { fail, privateDir, stateRoot, writePrivateJson } from "./io.mjs";

function usage() {
  return `Usage: node benchmarks/harness/p6.mjs <command> [run-id]

Commands:
  validate          validate the P6 manifest and local prerequisites
  run <run-id>       execute one full P6 run (either harness) and print its result path
  summarize          print completion status for every manifest run
`;
}

export async function commandValidate() {
  const manifest = loadP6Manifest();
  validateP6Manifest(manifest);
  process.stdout.write("P6 manifest is valid.\n");
}

function resolveAvailableModels() {
  if (isOfflineTest()) {
    return JSON.parse(process.env.P5_AVAILABLE_MODELS ?? "[]");
  }
  return listAvailableModels();
}

function resultPathFor(state, runId) {
  return `${state}/runs/${runId}/run-result.json`;
}

export async function commandRun(runId) {
  const manifest = loadP6Manifest();
  validateP6Manifest(manifest);
  const run = manifest.runs.find((candidate) => candidate.id === runId);
  if (!run) {
    fail(
      `Unknown P6 run id '${runId}'. Available: ${manifest.runs.map((candidate) => candidate.id).join(", ")}.`,
    );
  }
  const state = stateRoot();
  const resultPath = resultPathFor(state, run.id);
  if (existsSync(resultPath)) {
    fail(
      `P6 run '${runId}' already has a stored result at ${resultPath}. Remove it before running again.`,
    );
  }
  const result = await runP6Task({
    root: SOURCE_ROOT,
    manifest,
    run,
    privateRoot: resolvePrivateRoot(),
    availableModels: resolveAvailableModels(),
    launchAgentByHarness: {
      pi: createLaunchPiAgent({ manifest, state }),
      codex: createLaunchCodexAgent({ manifest, state }),
    },
    collectPiMetrics,
    collectCodexMetrics: ({ taskId, rolloutPath, launchSessionMetrics }) =>
      collectCodexMetrics({ taskId, rolloutPath, launchSessionMetrics }),
  });
  privateDir(`${state}/runs/${run.id}`);
  writePrivateJson(resultPath, result);
  process.stdout.write(`Finished ${runId}; result stored at ${resultPath}.\n`);
}

export async function commandSummarize() {
  const manifest = loadP6Manifest();
  const state = stateRoot();
  const runs = manifest.runs.map((run) => {
    const path = resultPathFor(state, run.id);
    return {
      id: run.id,
      task: run.task,
      harness: run.harness,
      status: existsSync(path) ? "finished" : "missing",
    };
  });
  process.stdout.write(
    `${JSON.stringify({ reference: manifest.reference, runs }, null, 2)}\n`,
  );
}

export async function main(argv) {
  const [command, id] = argv;
  if (!command || command === "--help" || command === "-h") {
    process.stdout.write(usage());
    return;
  }
  if (command === "validate" && !id) return commandValidate();
  if (command === "summarize" && !id) return commandSummarize();
  if (command === "run" && id) return commandRun(id);
  fail(usage());
}
