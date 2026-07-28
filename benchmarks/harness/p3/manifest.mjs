/**
 * Loading and validating the immutable P3 run plan.
 *
 * The manifest defines which runs are scored; an invalid manifest fails the
 * whole controller rather than silently running a subset.
 */
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { agentModule, runtimePackagePath } from "./agent.mjs";
import { CONFIG_FILES, GNU_TIME, LEDGER_GATE_ENV, MANIFEST_PATH, PI_MODEL, PI_THINKING, REFERENCE, SECRET_LINK_NAMES, SOURCE_ROOT, TASK_IDS } from "./config.mjs";
import { fail, readJson, runGit } from "./io.mjs";

export function loadManifest() {
  const manifest = readJson(MANIFEST_PATH, "P3 manifest");
  return manifest;
}

function allRuns(manifest) {
  return [...manifest.runs, ...manifest.diagnostics];
}

export function findRun(manifest, id) {
  const run = allRuns(manifest).find((candidate) => candidate.id === id);
  if (!run) fail(`Unknown P3 run id '${id}'. Run 'validate' or inspect p3-manifest.json.`);
  return run;
}

export function validateManifest(manifest) {
  if (manifest.schemaVersion !== "1.0.0") fail("P3 manifest schemaVersion must be 1.0.0.");
  if (manifest.reference !== REFERENCE) fail(`P3 manifest reference must be ${REFERENCE}.`);
  if (manifest.scoredRunCount !== 35) fail("P3 manifest scoredRunCount must be 35.");
  if (manifest.model !== PI_MODEL || manifest.thinking !== PI_THINKING) {
    fail(`P3 manifest must pin ${PI_MODEL} with ${PI_THINKING} thinking.`);
  }
  if (!Array.isArray(manifest.runs) || manifest.runs.length !== 35) {
    fail("P3 manifest must contain exactly 35 scored runs.");
  }
  if (!manifest.runs.every((run) => run.scored === true)) fail("All P3 manifest runs must be scored.");
  const ids = allRuns(manifest).map((run) => run.id);
  if (new Set(ids).size !== ids.length) fail("P3 manifest run ids must be unique.");
  for (const run of allRuns(manifest)) {
    if (typeof run.id !== "string" || !/^p3-[a-z0-9-]+$/.test(run.id)) {
      fail("P3 manifest run ids must be path-safe p3 identifiers.");
    }
    if (!TASK_IDS.has(run.task)) fail(`P3 manifest contains an unknown task '${run.task}'.`);
    const environmentKeys = Object.keys(run.environment ?? {});
    const allowsOnlyLedgerGate =
      run.task === "11-context-ledger-survival" &&
      run.variant === "ledger-disabled" &&
      environmentKeys.length === 1 &&
      run.environment?.[LEDGER_GATE_ENV] === "1";
    if (environmentKeys.length > 0 && !allowsOnlyLedgerGate) {
      fail(`P3 run '${run.id}' has an unsupported environment override.`);
    }
  }

  for (const number of ["01", "02", "03", "04", "05", "06", "07", "08", "09"]) {
    const matching = manifest.runs.filter((run) => run.task.startsWith(`${number}-`));
    if (matching.length !== 3) fail(`P3 task ${number} must have exactly three scored runs.`);
  }
  const task10 = manifest.runs.filter((run) => run.task.startsWith("10-"));
  if (task10.length !== 6) fail("P3 task 10 must have three A/B pairs (six scored runs).");
  for (const pair of ["p3-10-1", "p3-10-2", "p3-10-3"]) {
    const variants = task10.filter((run) => run.pair === pair).map((run) => run.variant).sort();
    if (JSON.stringify(variants) !== JSON.stringify(["with-subagent", "without-subagent"])) {
      fail(`P3 ${pair} must contain one with-subagent and one without-subagent run.`);
    }
  }
  const task11 = manifest.runs.filter((run) => run.task.startsWith("11-"));
  if (task11.length !== 2) fail("P3 task 11 must have one active/disabled A/B pair.");
  const active = task11.find((run) => run.variant === "ledger-active");
  const disabled = task11.find((run) => run.variant === "ledger-disabled");
  if (!active || !disabled || active.environment !== undefined ||
      disabled.environment?.[LEDGER_GATE_ENV] !== "1") {
    fail("P3 task 11 must omit the ledger gate for active and set it to '1' only for disabled.");
  }
  const expectedDiagnostics = new Set([
    "p3-diag-02-v8-cpu",
    "p3-diag-02-v8-heap",
    "p3-diag-09-v8-cpu",
    "p3-diag-09-v8-heap",
  ]);
  if (!Array.isArray(manifest.diagnostics) || manifest.diagnostics.length !== expectedDiagnostics.size ||
      !manifest.diagnostics.every((run) => expectedDiagnostics.has(run.id) && run.scored === false)) {
    fail("P3 manifest must expose the four unscored V8 diagnostics for tasks 02 and 09.");
  }
}

export function validatePrerequisites() {
  if (!existsSync(GNU_TIME)) fail("GNU time is required at /usr/bin/time.");
  const timeVersion = spawnSync(GNU_TIME, ["--version"], { encoding: "utf8" });
  if (timeVersion.status !== 0 || !/GNU time/i.test(timeVersion.stdout)) {
    fail("/usr/bin/time is not GNU time; P3 requires GNU time -v.");
  }
  if (runGit(["cat-file", "-e", `${REFERENCE}^{commit}`], { allowFailure: true }) === null) {
    fail(`Reference commit ${REFERENCE} is unavailable locally.`);
  }
  for (const configFile of CONFIG_FILES) {
    if (!existsSync(join(SOURCE_ROOT, configFile))) fail(`Required non-sensitive config file is missing: ${configFile}`);
  }
  for (const name of SECRET_LINK_NAMES) {
    const source = join(SOURCE_ROOT, name);
    if (!existsSync(source) || !lstatSync(source).isFile()) {
      fail(`Required credential source '${name}' is missing or is not a regular file.`);
    }
  }
  const cli = agentModule();
  if (!existsSync(cli)) fail("The local Pi runtime entrypoint is missing.");
  if (!process.env.P3_AGENT_MODULE) {
    const runtime = JSON.parse(readFileSync(runtimePackagePath(cli), "utf8"));
    if (runtime.version !== "0.82.0") {
      fail(`P3 requires Pi runtime 0.82.0; found ${runtime.version}.`);
    }
  }
}
