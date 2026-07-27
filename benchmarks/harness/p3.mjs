#!/usr/bin/env node
/**
 * P3 benchmark controller.
 *
 * This controller deliberately keeps all mutable material outside the source
 * checkout. It never reads, copies, prints, or serializes credentials: the
 * two runtime credential files are only linked into an isolated worktree for
 * the lifetime of one run.
 */
import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE_ROOT = resolve(HERE, "..", "..");
const MANIFEST_PATH = join(HERE, "p3-manifest.json");
const METRICS_PATH = join(HERE, "collect-metrics.mjs");
const REFERENCE = "e46915680d859ac9d6cac615cc197d5a31d46461";
const GNU_TIME = "/usr/bin/time";
const PI_MODEL = "opencode-go/kimi-k2.7-code";
const PI_THINKING = "high";
const GLOBAL_PI_BIN = join(homedir(), ".npm-global", "bin", "pi");
const FIXTURE_TEST_TASKS = new Set([
  "02-local-bug",
  "03-failing-unit-test",
  "05-refactor-no-behavior-change",
]);
const NO_VERIFY_TASKS = new Set([
  "06-unfamiliar-code-navigation",
  "09-hanging-tool-call",
]);
const SECRET_LINK_NAMES = ["auth.json", "models-store.json"];
const TASK_IDS = new Set([
  "01-single-file-change",
  "02-local-bug",
  "03-failing-unit-test",
  "04-multi-file-change",
  "05-refactor-no-behavior-change",
  "06-unfamiliar-code-navigation",
  "07-underspecified-request",
  "08-long-session-compaction",
  "09-hanging-tool-call",
  "10-with-without-subagent",
  "11-context-ledger-survival",
]);
const LEDGER_GATE_ENV = "PI_BENCHMARK_DISABLE_LEDGER_CHECKPOINTS";
const CONFIG_FILES = [
  "settings.json",
  "setup.json",
  "keybindings.json",
  "extensions/subagent/config.json",
  "npm/package.json",
  "npm/package-lock.json",
];

function fail(message) {
  throw new Error(message);
}

function usage() {
  return `Usage: node benchmarks/harness/p3.mjs <command> [run-id]

Commands:
  validate                 validate the immutable manifest and local prerequisites
  prepare <run-id>         create one isolated P3 worktree and explicit session path
  launch <run-id>          run the benchmark task (or an unscored diagnostic)
  finish <run-id>          collect metrics and write the result to local state
  cleanup <run-id> [--purge] remove credential links and the isolated worktree
  summarize                print completion status for the 35 scored runs
`;
}

function stateRoot() {
  const base = process.env.XDG_STATE_HOME
    ? resolve(process.env.XDG_STATE_HOME)
    : join(homedir(), ".local", "state");
  const state = join(base, "pi-p3");
  mkdirSync(state, { recursive: true, mode: 0o700 });
  chmodSync(state, 0o700);
  return state;
}

function privateDir(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
  return path;
}

function writePrivateJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  chmodSync(path, 0o600);
}

function readJson(path, description) {
  if (!existsSync(path)) fail(`${description} is missing.`);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    fail(`${description} is not valid JSON.`);
  }
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function runGit(args, { cwd = SOURCE_ROOT, allowFailure = false } = {}) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) {
    if (allowFailure) return null;
    fail(`Git command failed: git ${args.join(" ")}`);
  }
  return result.stdout.trim();
}

function loadManifest() {
  const manifest = readJson(MANIFEST_PATH, "P3 manifest");
  return manifest;
}

function allRuns(manifest) {
  return [...manifest.runs, ...manifest.diagnostics];
}

function findRun(manifest, id) {
  const run = allRuns(manifest).find((candidate) => candidate.id === id);
  if (!run) fail(`Unknown P3 run id '${id}'. Run 'validate' or inspect p3-manifest.json.`);
  return run;
}

function validateManifest(manifest) {
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

function validatePrerequisites() {
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

function defaultAgentModule() {
  const configured = process.env.P3_PI_BIN ?? GLOBAL_PI_BIN;
  if (!isAbsolute(configured) || !existsSync(configured)) {
    fail("P3_PI_BIN must name an existing absolute Pi executable.");
  }
  return realpathSync(configured);
}

function isOfflineTest() {
  return process.env.P3_OFFLINE_TEST === "1";
}

function agentModule() {
  // Kept solely as an offline test seam. Production runs always use the local
  // pinned Pi runtime; an override must remain inside this source checkout.
  const override = process.env.P3_AGENT_MODULE;
  if (!override) return defaultAgentModule();
  if (!isOfflineTest()) {
    fail("P3_AGENT_MODULE is reserved for the offline controller test.");
  }
  const candidate = resolve(override);
  const sourcePrefix = `${SOURCE_ROOT}/`;
  if (!candidate.startsWith(sourcePrefix) || !existsSync(candidate)) {
    fail("P3_AGENT_MODULE must name an existing module inside the source checkout.");
  }
  return candidate;
}

function runtimePackagePath(entrypoint) {
  if (process.env.P3_AGENT_MODULE) {
    return join(
      SOURCE_ROOT,
      "npm/node_modules/@earendil-works/pi-coding-agent/package.json",
    );
  }
  return join(dirname(dirname(entrypoint)), "package.json");
}

function agentInvocation(run, paths) {
  const v8Args = diagnosticV8Args(run, paths);
  const entrypoint = agentModule();
  if (process.env.P3_AGENT_MODULE || v8Args.length > 0) {
    return [process.execPath, ...v8Args, entrypoint];
  }
  return [entrypoint];
}

function runPaths(state, run) {
  const runDir = join(state, "runs", run.id);
  return {
    runDir,
    worktree: join(state, "worktrees", run.id),
    meta: join(runDir, "run.json"),
    session: join(runDir, "session.jsonl"),
    environment: join(runDir, "automatic-environment.json"),
    resources: join(runDir, "automatic-resources.json"),
    result: join(runDir, "run-result.json"),
  };
}

function assertSafeStatePath(state, candidate) {
  const relativePath = relative(state, candidate);
  if (relativePath === "" || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    fail("Refusing to operate outside the P3 state directory.");
  }
}

function configFingerprint(worktree, benchmarkOverlays, benchmarkEnvironmentOverrides) {
  const files = CONFIG_FILES.map((path) => ({ path, sha256: sha256File(join(worktree, path)) }));
  const configHash = createHash("sha256")
    .update(files.map((file) => `${file.path}\0${file.sha256}\n`).join(""))
    .digest("hex");
  const entrypoint = agentModule();
  const runtimePackage = runtimePackagePath(entrypoint);
  const runtime = JSON.parse(readFileSync(runtimePackage, "utf8"));
  return {
    reference: REFERENCE,
    model: PI_MODEL,
    thinking: PI_THINKING,
    configHash,
    configFiles: files,
    benchmarkOverlays,
    benchmarkEnvironmentOverrides,
    runtime: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      piPackageVersion: runtime.version,
      piPackageFingerprint: sha256File(runtimePackage),
      piEntrypointFingerprint: sha256File(entrypoint),
    },
  };
}

function createCredentialLinks(worktree) {
  for (const name of SECRET_LINK_NAMES) {
    const destination = join(worktree, name);
    if (existsSync(destination)) fail(`Refusing to replace existing worktree file '${name}'.`);
    // Do not inspect either file: symlink creation is the only credential I/O.
    symlinkSync(join(SOURCE_ROOT, name), destination);
  }
}

function removeCredentialLinks(worktree) {
  for (const name of SECRET_LINK_NAMES) {
    const destination = join(worktree, name);
    let stat;
    try {
      stat = lstatSync(destination);
    } catch {
      continue;
    }
    if (!stat.isSymbolicLink()) fail(`Refusing to remove non-symlink '${name}' from P3 worktree.`);
    rmSync(destination, { force: true });
  }
}

function linkRuntimeDependencies(worktree) {
  const sourceModules = join(SOURCE_ROOT, "npm", "node_modules");
  const destination = join(worktree, "npm", "node_modules");
  if (!existsSync(sourceModules)) fail("P3 requires npm/node_modules in the source checkout.");
  if (existsSync(destination)) fail("Refusing to replace an existing worktree npm/node_modules path.");
  symlinkSync(sourceModules, destination);
}

function applyBenchmarkOverlay(worktree, run) {
  // Both sides of the task-11 A/B pair receive the identical, benchmark-only
  // gate-capable module. The environment flag is the sole behavioral delta.
  if (run.task !== "11-context-ledger-survival") {
    return [];
  }
  const relativePath = "extensions/plan-mode/ledger-checkpoint.ts";
  const source = join(
    SOURCE_ROOT,
    "benchmarks",
    "harness",
    "fixtures",
    "ledger-checkpoint.ts",
  );
  const destination = join(worktree, relativePath);
  cpSync(source, destination);
  stageHarnessInput(worktree, relativePath);
  return [{ path: relativePath, sha256: sha256File(source) }];
}

function stageHarnessInput(worktree, path) {
  runGit(["add", "--force", "--", path], { cwd: worktree });
}

function stageWorktreePackageManifest(worktree) {
  const packagePath = join(worktree, "package.json");
  if (!existsSync(packagePath)) {
    writeFileSync(packagePath, '{"private":true,"type":"module"}\n', {
      encoding: "utf8",
      mode: 0o600,
    });
    stageHarnessInput(worktree, "package.json");
  }
  return { path: "package.json", sha256: sha256File(packagePath) };
}

function stageWorktreePermissionOverlay(worktree) {
  // P3 measures task completion, so every isolated worktree starts with the
  // same explicit write-capable workflow default. The source checkout is
  // never changed; the effective setup.json hash is recorded with the run.
  const setupPath = join(worktree, "setup.json");
  const setup = JSON.parse(readFileSync(setupPath, "utf8"));
  if (!setup.permissions || typeof setup.permissions !== "object") {
    fail("P3 setup.json is missing its permissions configuration.");
  }
  const defaults = setup.permissions.workflowDefaults;
  if (!defaults || typeof defaults !== "object") {
    fail("P3 setup.json is missing permissions.workflowDefaults.");
  }
  for (const mode of ["work", "simple_plan", "detailed_plan"]) {
    defaults[mode] = "full-access";
  }
  writeFileSync(setupPath, `${JSON.stringify(setup, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  stageHarnessInput(worktree, "setup.json");
  return { path: "setup.json", sha256: sha256File(setupPath) };
}

function prepareTaskInput(worktree, run) {
  const fixture = join(worktree, "benchmarks", "tasks", run.task, "fixture");
  if (existsSync(fixture)) {
    const destination = join(worktree, "benchmark-fixture");
    cpSync(fixture, destination, { recursive: true });
    stageHarnessInput(worktree, "benchmark-fixture");
  }
  if (run.task === "09-hanging-tool-call") {
    const piDir = join(worktree, ".pi");
    privateDir(piDir);
    const lspPath = join(piDir, "lsp.json");
    writePrivateJson(lspPath, {
      languages: {
        typescript: {
          enabled: true,
          command: "python3",
          args: [join(worktree, "benchmark-fixture", "fake-lsp.py"), "--hang"],
          rootMarkers: ["package.json"],
        },
      },
    });
    stageHarnessInput(worktree, ".pi/lsp.json");
  }
}

function taskPrompt(run, worktree) {
  if (run.task === "08-long-session-compaction") {
    return [
      "Lies extensions/lsp/server-profiles.ts und extensions/lsp/roots.ts und fasse das Zusammenspiel in eigenen Worten zusammen.",
      'Füge ein neues, standardmäßig deaktiviertes Profil zig hinzu (Server zls, rootMarkers: ["build.zig"], Sprachzuordnung .zig → { profileId: "zig", languageId: "zig" }).',
      "Ergänze einen Regressionstest analog zu den bestehenden Server-Profil-Tests in tests/run.mjs.",
      "Fasse am Ende zusammen, was in dieser Sitzung geändert wurde und ob noch etwas fehlt.",
    ];
  }
  if (run.task === "11-context-ledger-survival") {
    return [
      "Wir legen fest: neue LSP-Server-Profile sind standardmäßig deaktiviert (enabled: false). Bestätige diese Entscheidung und halte als Nicht-Ziel fest, dass bestehende Profile (typescript, python, go, rust, c, java) in dieser Aufgabe nicht verändert werden.",
      'Architektur-Detail: Das neue Profil zig verwendet den Server zls mit rootMarkers: ["build.zig"]. Halte das als Architekturentscheidung fest.',
      'Setze das um: füge in extensions/lsp/server-profiles.ts das Profil zig hinzu (enabled: false, Server zls, rootMarkers: ["build.zig"], Sprachzuordnung .zig → { profileId: "zig", languageId: "zig" }) und ergänze einen Regressionstest in tests/run.mjs analog zu den bestehenden Server-Profil-Tests.',
      "Fasse am Ende zusammen: (a) welche Entscheidung wir getroffen haben, (b) welches Nicht-Ziel gilt, (c) welche Architekturentscheidung für zig gilt und (d) welche Todos noch offen sind.",
    ];
  }
  const spec = readFileSync(join(worktree, "benchmarks", "tasks", run.task, "TASK.md"), "utf8");
  const quoted = spec
    .split("\n")
    .filter((line) => line.startsWith("> "))
    .map((line) => line.slice(2))
    .join("\n")
    .trim();
  if (!quoted) fail(`Task ${run.task} has no quoted prompt.`);
  return [quoted];
}

function promptFingerprint(run, worktree) {
  return createHash("sha256")
    .update(JSON.stringify({ prompts: taskPrompt(run, worktree), system: appendSystemPrompt(run) ?? null }))
    .digest("hex");
}

function appendSystemPrompt(run) {
  if (run.variant === "without-subagent") return "Bearbeite dies vollständig selbst, ohne das subagent-Tool zu verwenden.";
  if (run.variant === "with-subagent") return "Du darfst Teilaufgaben an Subagenten delegieren, wenn das sinnvoll ist (zum Beispiel Recherche durch einen Scout).";
  if (run.task === "09-hanging-tool-call") return "Für diese Aufgabe ist die projektlokale LSP-Testkonfiguration bereits vorbereitet. Nutze extensions/diff-viewer/change-tracker.ts als Ziel für den Definitions-Lookup.";
  return undefined;
}

function diagnosticV8Args(run, paths) {
  if (run.scored) return [];
  privateDir(join(paths.runDir, "diagnostics"));
  if (run.mode === "v8-cpu-prof") return ["--cpu-prof", "--cpu-prof-dir", join(paths.runDir, "diagnostics")];
  if (run.mode === "v8-heap-prof") return ["--heap-prof", "--heap-prof-dir", join(paths.runDir, "diagnostics")];
  fail(`Unknown diagnostic V8 mode '${run.mode}'.`);
}

function parseWallSeconds(raw) {
  const value = raw.trim();
  const parts = value.split(":").map(Number);
  if (parts.some((part) => Number.isNaN(part))) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

function parseGnuTime(path) {
  if (!existsSync(path)) return null;
  const values = new Map();
  for (const line of readFileSync(path, "utf8").split("\n")) {
    // GNU time's wall-clock label itself contains `h:mm:ss`, so split at
    // the first colon followed by a space rather than the final colon.
    const separator = line.indexOf(": ");
    if (separator > 0) values.set(line.slice(0, separator).trim(), line.slice(separator + 2).trim());
  }
  const numeric = (label) => {
    const value = Number(values.get(label));
    return Number.isFinite(value) ? value : null;
  };
  return {
    cpuUserSeconds: numeric("User time (seconds)"),
    cpuSystemSeconds: numeric("System time (seconds)"),
    wallSeconds: parseWallSeconds(values.get("Elapsed (wall clock) time (h:mm:ss or m:ss)") ?? ""),
    peakRssKiB: numeric("Maximum resident set size (kbytes)"),
  };
}

function spawnToFiles(command, args, options) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, options);
    child.on("error", rejectPromise);
    child.on("close", (code, signal) => resolvePromise({ code: code ?? 1, signal: signal ?? null }));
  });
}

function launchEnvironment(run, paths) {
  const environment = {
    ...process.env,
    PI_CODING_AGENT_DIR: paths.worktree,
    PI_CODING_AGENT_SESSION_DIR: paths.runDir,
  };
  delete environment[LEDGER_GATE_ENV];
  return { ...environment, ...benchmarkEnvironmentOverrides(run) };
}

function benchmarkEnvironmentOverrides(run) {
  // Ledger checkpoints are intentionally benchmarked only by task 11. They
  // would otherwise add an unrelated docs/CONTEXT_LEDGER.md mutation when a
  // task session shuts down, so all other tasks use the explicit gate.
  if (run.task !== "11-context-ledger-survival") {
    return { [LEDGER_GATE_ENV]: "1" };
  }
  return run.environment ?? {};
}

async function runAgentSession(run, paths, prompts) {
  const timeFile = join(paths.runDir, "time-session.txt");
  const systemPrompt = appendSystemPrompt(run);
  const args = [
    "-v",
    "-o",
    timeFile,
    ...agentInvocation(run, paths),
    "--offline",
    "--approve",
    "--session",
    paths.session,
    "--session-dir",
    paths.runDir,
    "--name",
    run.id,
    "--model",
    PI_MODEL,
    "--thinking",
    PI_THINKING,
  ];
  if (run.task === "11-context-ledger-survival") args.push("--plan");
  if (systemPrompt) args.push("--append-system-prompt", systemPrompt);
  args.push("--print", ...prompts);
  // Do not retain Pi stdout/stderr: an agent may handle credentials through
  // its runtime, and P3 needs only the session plus GNU-time measurements.
  const processResult = await spawnToFiles(GNU_TIME, args, {
    cwd: paths.worktree,
    env: launchEnvironment(run, paths),
    stdio: "ignore",
  });
  const measurement = parseGnuTime(timeFile);
  if (!measurement) fail(`GNU time did not produce a resource record for ${run.id}.`);
  return { label: "session", exitCode: processResult.code, signal: processResult.signal, ...measurement };
}

function aggregateResources(launches) {
  const sum = (key) => launches.reduce((total, launch) => total + (launch[key] ?? 0), 0);
  const peaks = launches.map((launch) => launch.peakRssKiB).filter((value) => value !== null);
  return {
    launches,
    totalCpuUserSeconds: sum("cpuUserSeconds"),
    totalCpuSystemSeconds: sum("cpuSystemSeconds"),
    totalWallSeconds: sum("wallSeconds"),
    peakRssKiB: peaks.length > 0 ? Math.max(...peaks) : null,
  };
}

function listJsonlFiles(directory) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const candidate = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listJsonlFiles(candidate));
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(candidate);
  }
  return files.sort();
}

function subagentSessionPaths(paths) {
  return listJsonlFiles(paths.runDir).filter((candidate) => candidate !== paths.session);
}

function countSubagentToolCalls(sessionPath) {
  if (!existsSync(sessionPath)) return 0;
  let calls = 0;
  for (const line of readFileSync(sessionPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry?.type !== "message" || entry.message?.role !== "assistant") continue;
      for (const block of entry.message.content ?? []) {
        if (block?.type === "toolCall" && block.name === "subagent") calls += 1;
      }
    } catch {
      // The collector will treat malformed session data as unavailable rather
      // than allowing P3 to infer a subagent call from it.
    }
  }
  return calls;
}

function subagentSpawnCap(worktree) {
  const config = readJson(
    join(worktree, "extensions", "subagent", "config.json"),
    "P3 subagent configuration",
  );
  const cap = config.maxSubagentSpawnsPerSession;
  if (!Number.isInteger(cap) || cap < 1) {
    fail("P3 subagent configuration has no valid maxSubagentSpawnsPerSession.");
  }
  return cap;
}

function readMeta(paths) {
  return readJson(paths.meta, "P3 run metadata");
}

function requireStatus(meta, allowed, command) {
  if (!allowed.includes(meta.status)) {
    fail(`P3 run '${meta.id}' is ${meta.status}; cannot ${command}.`);
  }
}

function summarizedStatus(meta, paths) {
  if (meta.status !== "finished" || !existsSync(paths.resources)) {
    return meta.status;
  }
  try {
    const resources = readJson(paths.resources, "P3 launch resources");
    if (resources.launches?.some((launch) => launch.exitCode !== 0)) {
      return "invalid";
    }
  } catch {
    return "invalid";
  }
  return meta.status;
}

async function commandValidate() {
  const manifest = loadManifest();
  validateManifest(manifest);
  validatePrerequisites();
  process.stdout.write("P3 manifest and prerequisites are valid.\n");
}

async function commandPrepare(id) {
  const manifest = loadManifest();
  validateManifest(manifest);
  validatePrerequisites();
  const run = findRun(manifest, id);
  const state = stateRoot();
  const paths = runPaths(state, run);
  assertSafeStatePath(state, paths.runDir);
  assertSafeStatePath(state, paths.worktree);
  if (existsSync(paths.runDir) || existsSync(paths.worktree)) {
    fail(`P3 run '${id}' already has local state. Run cleanup ${id} --purge before preparing it again.`);
  }
  privateDir(dirname(paths.runDir));
  privateDir(dirname(paths.worktree));
  privateDir(paths.runDir);
  try {
    runGit(["worktree", "add", "--detach", paths.worktree, REFERENCE]);
    const actualReference = runGit(["rev-parse", "HEAD"], { cwd: paths.worktree });
    if (actualReference !== REFERENCE) fail("P3 worktree did not resolve to the required reference commit.");
    linkRuntimeDependencies(paths.worktree);
    const packageManifest = stageWorktreePackageManifest(paths.worktree);
    const permissionOverlay = stageWorktreePermissionOverlay(paths.worktree);
    prepareTaskInput(paths.worktree, run);
    const benchmarkOverlays = [
      permissionOverlay,
      ...applyBenchmarkOverlay(paths.worktree, run),
    ];
    createCredentialLinks(paths.worktree);
    const environmentOverrides = benchmarkEnvironmentOverrides(run);
    const environment = {
      ...configFingerprint(paths.worktree, benchmarkOverlays, environmentOverrides),
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
    try { removeCredentialLinks(paths.worktree); } catch {}
    try { runGit(["worktree", "remove", "--force", paths.worktree], { allowFailure: true }); } catch {}
    try { rmSync(paths.worktree, { recursive: true, force: true }); } catch {}
    try { rmSync(paths.runDir, { recursive: true, force: true }); } catch {}
    throw error;
  }
  process.stdout.write(`Prepared ${id}; session path is recorded in local P3 state.\n`);
}

async function commandLaunch(id) {
  const manifest = loadManifest();
  validateManifest(manifest);
  const run = findRun(manifest, id);
  const state = stateRoot();
  const paths = runPaths(state, run);
  const meta = readMeta(paths);
  requireStatus(meta, ["prepared"], "launch");
  if (!existsSync(paths.worktree)) fail("P3 worktree is missing; prepare the run again.");
  const launches = [await runAgentSession(run, paths, taskPrompt(run, paths.worktree))];
  const subagentCalls = countSubagentToolCalls(paths.session);
  const subagentSessions = subagentSessionPaths(paths);
  const subagentCap = subagentSpawnCap(paths.worktree);
  const resources = aggregateResources(launches);
  writePrivateJson(paths.resources, resources);
  const variantViolation =
    (run.variant === "without-subagent" && subagentCalls > 0) ||
    (run.variant === "with-subagent" && subagentCalls > subagentCap);
  meta.status = launches.every((launch) => launch.exitCode === 0) && !variantViolation
    ? "launched"
    : "launch-failed";
  meta.launchedAt = new Date().toISOString();
  meta.launchCount = launches.length;
  meta.subagentCalls = subagentCalls;
  meta.subagentSpawnCap = subagentCap;
  meta.subagentSessionPaths = subagentSessions;
  meta.variantViolation = variantViolation;
  writePrivateJson(paths.meta, meta);
  process.stdout.write(`${run.scored ? "Scored" : "Diagnostic"} launch ${id} completed with ${launches.length} GNU-time record(s).\n`);
}

async function runVerification(run, paths) {
  if (NO_VERIFY_TASKS.has(run.task)) return null;
  const output = join(paths.runDir, "verify-result.json");
  if (!FIXTURE_TEST_TASKS.has(run.task)) {
    const { openSync } = await import("node:fs");
    const fd = openSync(output, "w", 0o600);
    try {
      await spawnToFiles(join(HERE, "run-verify.sh"), [paths.worktree], {
        cwd: SOURCE_ROOT,
        env: { ...process.env, PI_CODING_AGENT_DIR: paths.worktree },
        stdio: ["ignore", fd, "ignore"],
      });
    } finally {
      closeSync(fd);
    }
    const verify = readJson(output, "P3 verification result");
    if (!Number.isInteger(verify.exitCode) || !Number.isInteger(verify.durationMs)) {
      fail("P3 verification result has an invalid contract.");
    }
    chmodSync(output, 0o600);
    return output;
  }

  const logFile = join(paths.runDir, "verify.log");
  writeFileSync(logFile, "", { mode: 0o600 });
  const { openSync } = await import("node:fs");
  const fd = openSync(logFile, "a", 0o600);
  const started = Date.now();
  let result;
  try {
    result = await spawnToFiles(process.execPath, [join(paths.worktree, "benchmark-fixture", "run-fixture-test.mjs")], {
      cwd: paths.worktree,
      env: { ...process.env, PI_CODING_AGENT_DIR: paths.worktree },
      stdio: ["ignore", fd, fd],
    });
  } finally {
    closeSync(fd);
  }
  const verify = { exitCode: result.code, durationMs: Date.now() - started, logFile };
  writePrivateJson(output, verify);
  return output;
}

async function commandFinish(id) {
  const manifest = loadManifest();
  validateManifest(manifest);
  const run = findRun(manifest, id);
  if (!run.scored) fail("Diagnostic runs are intentionally unscored and cannot be finished.");
  const state = stateRoot();
  const paths = runPaths(state, run);
  const meta = readMeta(paths);
  requireStatus(meta, ["launched", "launch-failed"], "finish");
  if (!existsSync(paths.resources)) fail("P3 launch resources are missing; launch the run before finishing.");
  const verifyResult = await runVerification(run, paths);
  const args = [
    METRICS_PATH,
    "--task", run.task,
    "--worktree", paths.worktree,
    "--session", paths.session,
    "--environment-file", paths.environment,
    "--resources-file", paths.resources,
    "--subagent-calls", String(meta.subagentCalls ?? 0),
  ];
  for (const sessionPath of subagentSessionPaths(paths)) {
    args.push("--subagent-session", sessionPath);
  }
  if (verifyResult) args.push("--verify-result", verifyResult);
  if (run.task === "11-context-ledger-survival") {
    args.push("--ledger-expects", "enabled: false|bestehende Profile|zls|build.zig");
  }
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
  if (result.code !== 0) fail("Metric collection failed; inspect the local P3 result file.");
  const verifyExitCode = verifyResult
    ? readJson(verifyResult, "P3 verification result").exitCode
    : 0;
  meta.status = meta.status === "launched" && verifyExitCode === 0
    ? "finished"
    : "invalid";
  meta.finishedAt = new Date().toISOString();
  meta.resultPath = paths.result;
  writePrivateJson(paths.meta, meta);
  process.stdout.write(`Finished ${id}; result is stored only in local P3 state.\n`);
}

async function commandCleanup(id, purge) {
  const manifest = loadManifest();
  validateManifest(manifest);
  const run = findRun(manifest, id);
  const state = stateRoot();
  const paths = runPaths(state, run);
  assertSafeStatePath(state, paths.runDir);
  assertSafeStatePath(state, paths.worktree);
  if (existsSync(paths.worktree)) {
    removeCredentialLinks(paths.worktree);
    runGit(["worktree", "remove", "--force", paths.worktree], { allowFailure: true });
    if (existsSync(paths.worktree)) rmSync(paths.worktree, { recursive: true, force: true });
  }
  if (existsSync(paths.meta)) {
    const meta = readMeta(paths);
    meta.cleanedAt = new Date().toISOString();
    meta.worktreeRemoved = true;
    writePrivateJson(paths.meta, meta);
  }
  if (purge) rmSync(paths.runDir, { recursive: true, force: true });
  process.stdout.write(`Cleaned ${id}${purge ? " and purged its local state" : ""}.\n`);
}

async function commandSummarize() {
  const manifest = loadManifest();
  validateManifest(manifest);
  const state = stateRoot();
  const counts = { missing: 0, prepared: 0, launched: 0, "launch-failed": 0, finished: 0, invalid: 0, other: 0 };
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
  process.stdout.write(`${JSON.stringify({ reference: REFERENCE, scoredRunCount: 35, counts, runs }, null, 2)}\n`);
}

async function main(argv) {
  const [command, id, ...rest] = argv;
  if (!command || command === "--help" || command === "-h") {
    process.stdout.write(usage());
    return;
  }
  if (command === "validate" && !id) return commandValidate();
  if (command === "summarize" && !id) return commandSummarize();
  if (["prepare", "launch", "finish", "cleanup"].includes(command) && id) {
    if (command === "cleanup") {
      if (rest.length > 1 || (rest.length === 1 && rest[0] !== "--purge")) fail(usage());
      return commandCleanup(id, rest[0] === "--purge");
    }
    if (rest.length !== 0) fail(usage());
    if (command === "prepare") return commandPrepare(id);
    if (command === "launch") return commandLaunch(id);
    return commandFinish(id);
  }
  fail(usage());
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`P3: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
