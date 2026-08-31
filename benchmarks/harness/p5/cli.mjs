/**
 * P5 CLI commands: validate, run, summarize. Mirrors benchmarks/harness/p4/cli.mjs.
 */
import { existsSync } from "node:fs";
import { loadP5Manifest, validateP5Manifest } from "../p5-manifest.mjs";
import { runP5Task } from "../p5-controller.mjs";
import { privateRoot as resolvePrivateRoot } from "../v2-private.mjs";
import { isOfflineTest } from "./agent.mjs";
import { SOURCE_ROOT } from "./config.mjs";
import { collectCodexMetrics } from "./collect-codex-metrics.mjs";
import { collectPiMetrics } from "./collect-pi-metrics.mjs";
import { fail, privateDir, stateRoot, writePrivateJson } from "./io.mjs";
import { createLaunchCodexAgent } from "./launch-codex.mjs";
import { createLaunchPiAgent } from "./launch-pi.mjs";
import { listAvailableModels } from "./models.mjs";

function usage() {
  return `Usage: node benchmarks/harness/p5.mjs <command> [run-id]

Commands:
  validate          validate the P5 manifest and local prerequisites
  run <run-id>       execute one full P5 run (either harness) and print its result path
  summarize          print completion status for every manifest run
`;
}

export async function commandValidate() {
  const manifest = loadP5Manifest();
  validateP5Manifest(manifest);
  process.stdout.write("P5 manifest is valid.\n");
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
  const manifest = loadP5Manifest();
  validateP5Manifest(manifest);
  const run = manifest.runs.find((candidate) => candidate.id === runId);
  if (!run) {
    fail(
      `Unknown P5 run id '${runId}'. Available: ${manifest.runs.map((candidate) => candidate.id).join(", ")}.`,
    );
  }
  const state = stateRoot();
  const resultPath = resultPathFor(state, run.id);
  if (existsSync(resultPath)) {
    fail(
      `P5 run '${runId}' already has a stored result at ${resultPath}. Remove it before running again.`,
    );
  }
  const result = await runP5Task({
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
  const manifest = loadP5Manifest();
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
