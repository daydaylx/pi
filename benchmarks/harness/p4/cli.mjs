/**
 * P4 CLI commands: validate, run, summarize.
 *
 * Unlike P3's multi-step prepare/launch/finish state machine, p4-controller's
 * runP4Task already bundles prepare, launch, evaluate and cleanup into one
 * call with try/finally disposal — so `run` is a single command, not a
 * resumable sequence of separately persisted steps.
 */
import { existsSync } from "node:fs";
import { loadP4Manifest, validateP4Manifest } from "../p4-manifest.mjs";
import { runP4Task } from "../p4-controller.mjs";
import { privateRoot as resolvePrivateRoot } from "../v2-private.mjs";
import { isOfflineTest } from "./agent.mjs";
import { SOURCE_ROOT } from "./config.mjs";
import {
  fail,
  privateDir,
  runPaths,
  stateRoot,
  writePrivateJson,
} from "./io.mjs";
import { createLaunchAgent } from "./launch.mjs";
import { listAvailableModels } from "./models.mjs";

function usage() {
  return `Usage: node benchmarks/harness/p4.mjs <command> [run-id]

Commands:
  validate          validate the P4 manifest and local prerequisites
  run <run-id>       execute one full P4 run (prepare, launch, evaluate, store) and print its result path
  summarize          print completion status for every manifest run
`;
}

export async function commandValidate() {
  const manifest = loadP4Manifest();
  validateP4Manifest(manifest);
  process.stdout.write("P4 manifest is valid.\n");
}

function resolveAvailableModels() {
  if (isOfflineTest()) {
    return JSON.parse(process.env.P4_AVAILABLE_MODELS ?? "[]");
  }
  return listAvailableModels();
}

export async function commandRun(runId) {
  const manifest = loadP4Manifest();
  validateP4Manifest(manifest);
  const run = manifest.runs.find((candidate) => candidate.id === runId);
  if (!run) {
    fail(
      `Unknown P4 run id '${runId}'. Available: ${manifest.runs.map((candidate) => candidate.id).join(", ")}.`,
    );
  }
  const state = stateRoot();
  const paths = runPaths(state, run.id);
  if (existsSync(paths.result)) {
    fail(
      `P4 run '${runId}' already has a stored result at ${paths.result}. Remove it before running again.`,
    );
  }
  const result = await runP4Task({
    root: SOURCE_ROOT,
    manifest,
    run,
    privateRoot: resolvePrivateRoot(),
    availableModels: resolveAvailableModels(),
    launchAgent: createLaunchAgent({ manifest, state }),
  });
  privateDir(paths.runDir);
  writePrivateJson(paths.result, result);
  process.stdout.write(
    `Finished ${runId}; result stored at ${paths.result}.\n`,
  );
}

export async function commandSummarize() {
  const manifest = loadP4Manifest();
  const state = stateRoot();
  const runs = manifest.runs.map((run) => {
    const paths = runPaths(state, run.id);
    return {
      id: run.id,
      task: run.task,
      status: existsSync(paths.result) ? "finished" : "missing",
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
