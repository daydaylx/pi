/**
 * The six controller commands: validate, prepare, launch, finish, cleanup,
 * summarize.
 *
 * Each command is a state transition on one run directory and refuses to run
 * out of order (requireStatus).
 */
import { closeSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { isOfflineTest } from "./agent.mjs";
import {
  METRICS_PATH,
  REFERENCE,
  SECRET_LINK_NAMES,
  SOURCE_ROOT,
  benchmarkEnvironmentOverrides,
} from "./config.mjs";
import {
  assertSafeStatePath,
  fail,
  privateDir,
  readJson,
  runGit,
  runPaths,
  stateRoot,
  writePrivateJson,
} from "./io.mjs";
import {
  findRun,
  loadManifest,
  validateManifest,
  validatePrerequisites,
} from "./manifest.mjs";
import {
  countSubagentToolCalls,
  readMeta,
  requireStatus,
  subagentSessionPaths,
  subagentSpawnCap,
  summarizedStatus,
} from "./metrics.mjs";
import {
  aggregateResources,
  runAgentSession,
  spawnToFiles,
} from "./process.mjs";
import { prepareTaskInput, promptFingerprint, taskPrompt } from "./prompts.mjs";
import { runVerification } from "./verification.mjs";
import {
  configFingerprint,
  createCredentialLinks,
  linkRuntimeDependencies,
  removeCredentialLinks,
  stageWorktreePackageManifest,
  stageWorktreePermissionOverlay,
} from "./worktree.mjs";

export async function commandValidate() {
  const manifest = loadManifest();
  validateManifest(manifest);
  validatePrerequisites();
  process.stdout.write("P3 manifest and prerequisites are valid.\n");
}

export async function commandPrepare(id) {
  const manifest = loadManifest();
  validateManifest(manifest);
  validatePrerequisites();
  const run = findRun(manifest, id);
  const state = stateRoot();
  const paths = runPaths(state, run);
  assertSafeStatePath(state, paths.runDir);
  assertSafeStatePath(state, paths.worktree);
  if (existsSync(paths.runDir) || existsSync(paths.worktree)) {
    fail(
      `P3 run '${id}' already has local state. Run cleanup ${id} --purge before preparing it again.`,
    );
  }
  privateDir(dirname(paths.runDir));
  privateDir(dirname(paths.worktree));
  privateDir(paths.runDir);
  try {
    runGit(["worktree", "add", "--detach", paths.worktree, REFERENCE]);
    const actualReference = runGit(["rev-parse", "HEAD"], {
      cwd: paths.worktree,
    });
    if (actualReference !== REFERENCE)
      fail("P3 worktree did not resolve to the required reference commit.");
    linkRuntimeDependencies(paths.worktree);
    const packageManifest = stageWorktreePackageManifest(paths.worktree);
    const permissionOverlay = stageWorktreePermissionOverlay(paths.worktree);
    prepareTaskInput(paths.worktree, run);
    const benchmarkOverlays = [permissionOverlay];
    createCredentialLinks(paths.worktree);
    const environmentOverrides = benchmarkEnvironmentOverrides(run);
    const environment = {
      ...configFingerprint(
        paths.worktree,
        benchmarkOverlays,
        environmentOverrides,
      ),
      harnessScaffolding: [packageManifest],
      taskPromptFingerprint: promptFingerprint(run, paths.worktree),
      testOnly: isOfflineTest(),
      runId: run.id,
      task: run.task,
      scored: run.scored,
      variant: run.variant ?? null,
      pair: run.pair ?? null,
    };
    writePrivateJson(paths.environment, environment);
    writePrivateJson(paths.meta, {
      id: run.id,
      task: run.task,
      scored: run.scored,
      variant: run.variant ?? null,
      pair: run.pair ?? null,
      reference: REFERENCE,
      worktree: paths.worktree,
      sessionPath: paths.session,
      status: "prepared",
      preparedAt: new Date().toISOString(),
      credentialLinks: SECRET_LINK_NAMES,
    });
  } catch (error) {
    try {
      removeCredentialLinks(paths.worktree);
    } catch {}
    try {
      runGit(["worktree", "remove", "--force", paths.worktree], {
        allowFailure: true,
      });
    } catch {}
    try {
      rmSync(paths.worktree, { recursive: true, force: true });
    } catch {}
    try {
      rmSync(paths.runDir, { recursive: true, force: true });
    } catch {}
    throw error;
  }
  process.stdout.write(
    `Prepared ${id}; session path is recorded in local P3 state.\n`,
  );
}

export async function commandLaunch(id) {
  const manifest = loadManifest();
  validateManifest(manifest);
  const run = findRun(manifest, id);
  const state = stateRoot();
  const paths = runPaths(state, run);
  const meta = readMeta(paths);
  requireStatus(meta, ["prepared"], "launch");
  if (!existsSync(paths.worktree))
    fail("P3 worktree is missing; prepare the run again.");
  const launches = [
    await runAgentSession(run, paths, taskPrompt(run, paths.worktree)),
  ];
  const subagentCalls = countSubagentToolCalls(paths.session);
  const subagentSessions = subagentSessionPaths(paths);
  const subagentCap = subagentSpawnCap(paths.worktree);
  const resources = aggregateResources(launches);
  writePrivateJson(paths.resources, resources);
  const variantViolation =
    (run.variant === "without-subagent" && subagentCalls > 0) ||
    (run.variant === "with-subagent" && subagentCalls > subagentCap);
  meta.status =
    launches.every((launch) => launch.exitCode === 0) && !variantViolation
      ? "launched"
      : "launch-failed";
  meta.launchedAt = new Date().toISOString();
  meta.launchCount = launches.length;
  meta.subagentCalls = subagentCalls;
  meta.subagentSpawnCap = subagentCap;
  meta.subagentSessionPaths = subagentSessions;
  meta.variantViolation = variantViolation;
  writePrivateJson(paths.meta, meta);
  process.stdout.write(
    `${run.scored ? "Scored" : "Diagnostic"} launch ${id} completed with ${launches.length} GNU-time record(s).\n`,
  );
}

export async function commandFinish(id) {
  const manifest = loadManifest();
  validateManifest(manifest);
  const run = findRun(manifest, id);
  if (!run.scored)
    fail("Diagnostic runs are intentionally unscored and cannot be finished.");
  const state = stateRoot();
  const paths = runPaths(state, run);
  const meta = readMeta(paths);
  requireStatus(meta, ["launched", "launch-failed"], "finish");
  if (!existsSync(paths.resources))
    fail("P3 launch resources are missing; launch the run before finishing.");
  const verifyResult = await runVerification(run, paths);
  const args = [
    METRICS_PATH,
    "--task",
    run.task,
    "--worktree",
    paths.worktree,
    "--session",
    paths.session,
    "--environment-file",
    paths.environment,
    "--resources-file",
    paths.resources,
    "--subagent-calls",
    String(meta.subagentCalls ?? 0),
  ];
  for (const sessionPath of subagentSessionPaths(paths)) {
    args.push("--subagent-session", sessionPath);
  }
  if (verifyResult) args.push("--verify-result", verifyResult);
  writeFileSync(paths.result, "", { mode: 0o600 });
  const { openSync } = await import("node:fs");
  const fd = openSync(paths.result, "a", 0o600);
  let result;
  try {
    result = await spawnToFiles(process.execPath, args, {
      cwd: SOURCE_ROOT,
      env: { ...process.env },
      stdio: ["ignore", fd, fd],
    });
  } finally {
    closeSync(fd);
  }
  if (result.code !== 0)
    fail("Metric collection failed; inspect the local P3 result file.");
  const verifyExitCode = verifyResult
    ? readJson(verifyResult, "P3 verification result").exitCode
    : 0;
  meta.status =
    meta.status === "launched" && verifyExitCode === 0 ? "finished" : "invalid";
  meta.finishedAt = new Date().toISOString();
  meta.resultPath = paths.result;
  writePrivateJson(paths.meta, meta);
  process.stdout.write(
    `Finished ${id}; result is stored only in local P3 state.\n`,
  );
}

export async function commandCleanup(id, purge) {
  const manifest = loadManifest();
  validateManifest(manifest);
  const run = findRun(manifest, id);
  const state = stateRoot();
  const paths = runPaths(state, run);
  assertSafeStatePath(state, paths.runDir);
  assertSafeStatePath(state, paths.worktree);
  if (existsSync(paths.worktree)) {
    removeCredentialLinks(paths.worktree);
    runGit(["worktree", "remove", "--force", paths.worktree], {
      allowFailure: true,
    });
    if (existsSync(paths.worktree))
      rmSync(paths.worktree, { recursive: true, force: true });
  }
  if (existsSync(paths.meta)) {
    const meta = readMeta(paths);
    meta.cleanedAt = new Date().toISOString();
    meta.worktreeRemoved = true;
    writePrivateJson(paths.meta, meta);
  }
  if (purge) rmSync(paths.runDir, { recursive: true, force: true });
  process.stdout.write(
    `Cleaned ${id}${purge ? " and purged its local state" : ""}.\n`,
  );
}

export async function commandSummarize() {
  const manifest = loadManifest();
  validateManifest(manifest);
  const state = stateRoot();
  const counts = {
    missing: 0,
    prepared: 0,
    launched: 0,
    "launch-failed": 0,
    finished: 0,
    invalid: 0,
    other: 0,
  };
  const runs = manifest.runs.map((run) => {
    const paths = runPaths(state, run);
    if (!existsSync(paths.meta)) {
      counts.missing += 1;
      return { id: run.id, task: run.task, status: "missing" };
    }
    const status = summarizedStatus(readMeta(paths), paths);
    if (Object.hasOwn(counts, status)) counts[status] += 1;
    else counts.other += 1;
    return { id: run.id, task: run.task, status };
  });
  process.stdout.write(
    `${JSON.stringify({ reference: REFERENCE, scoredRunCount: manifest.scoredRunCount, counts, runs }, null, 2)}\n`,
  );
}
