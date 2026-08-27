// Regression-test bootstrap for the minimal Pi extension stack.
//
// The suite files contain domain-owned section bodies. This file intentionally
// owns loading, filtering and reporting so every filtered process keeps the
// same assertion and import-failure semantics.
import {
  assert,
  counters,
  recordThrow,
  setCurrentSection,
} from "./shared/assertions.mjs";
import { importModule } from "./shared/jiti-loader.mjs";
import {
  SECTION_SUITES,
  RUN_MJS_SUITES,
} from "./shared/run-suite-registry.mjs";
import { runtimeSections } from "./suites/runtime.mjs";
import { uiSections } from "./suites/ui.mjs";
import { lspSections } from "./suites/lsp.mjs";
import { diffSections } from "./suites/diff.mjs";

const requestedSuite = process.env.PI_TEST_SUITE;
if (requestedSuite && !RUN_MJS_SUITES.includes(requestedSuite)) {
  throw new Error(
    `Unknown PI_TEST_SUITE ${requestedSuite}; expected one of ${RUN_MJS_SUITES.join(", ")}.`,
  );
}

const unknownSections = new Set();

function suiteForSection(name) {
  const suite = SECTION_SUITES[name];
  if (!suite) unknownSections.add(name);
  return suite;
}

async function section(name, run) {
  if (requestedSuite && suiteForSection(name) !== requestedSuite) return;
  setCurrentSection(name);
  const before = counters();
  try {
    await run();
  } catch (error) {
    recordThrow(name, error);
  } finally {
    if (process.env.PI_SECTION_STATS === "1") {
      const now = counters();
      console.log(
        `STATS\t${now.passed - before.passed}\t${now.failed - before.failed}\t${name}`,
      );
    }
    setCurrentSection("");
  }
}

async function load(relativePath) {
  try {
    return await importModule(relativePath);
  } catch (error) {
    const detail =
      error instanceof Error ? (error.stack ?? error.message) : String(error);
    assert(false, "loads " + relativePath + ": " + detail);
    return undefined;
  }
}

// Keep every existing preload ahead of suite selection. A broken extension
// import must remain visible even when its owning section is filtered out.
const menuUi = await load("extensions/shared/menu-ui.ts");
const thinkingMenu = await load("extensions/shared/thinking-menu.ts");
const lspControlCenter = await load("extensions/lsp/control-center.ts");
const lspTools = await load("extensions/lsp/tools.ts");
const modePermissions = await load("extensions/mode-permissions.ts");
const planMode = await load("extensions/plan-mode/index.ts");
const controlPlane = await load("extensions/control-plane.ts");
const compactTools = await load("extensions/compact-tools/index.ts");
const diffAlgorithm = await load("extensions/diff-viewer/diff-algorithm.ts");
const diffFallback = await load("extensions/diff-viewer/git-diff.ts");
const diffTracker = await load("extensions/diff-viewer/change-tracker.ts");
const diffViewer = await load("extensions/diff-viewer/index.ts");
const askUser = await load("extensions/ask-user.ts");
const askUserPolicy = await load("extensions/shared/ask-user-policy.ts");
const lspExtensionMod = await load("extensions/lsp/index.ts");
const outputLimits = await load("extensions/shared/output-limits.ts");
const trackedExec = await load("extensions/shared/tracked-exec.ts");
const contextDiagnostics = await load(
  "extensions/setup-core/context-diagnostics.ts",
);
const setupConfig = await load("extensions/setup-core/config.ts");
const setupCore = await load("extensions/setup-core/index.ts");
const auroraState = await load("extensions/aurora-ui/state.ts");
const auroraUi = await load("extensions/aurora-ui/index.ts");
const auroraFooter = await load("extensions/aurora-ui/footer.ts");
const resilience = await load("extensions/resilience/index.ts");
const recoveryState = await load("extensions/resilience/recovery-state.ts");
const verifierPolicy = await load("extensions/permissions/verifier-policy.ts");
const sessionHealthAnalyze = await load("extensions/session-health/analyze.ts");
const sessionHealth = await load("extensions/session-health/index.ts");
const openrouterDoctor = await load("extensions/openrouter-doctor/index.ts");

const sections = {
  ...runtimeSections,
  ...uiSections,
  ...lspSections,
  ...diffSections,
};
const context = {
  section,
  load,
  menuUi,
  thinkingMenu,
  lspControlCenter,
  lspTools,
  modePermissions,
  planMode,
  controlPlane,
  compactTools,
  diffAlgorithm,
  diffFallback,
  diffTracker,
  diffViewer,
  askUser,
  askUserPolicy,
  lspExtensionMod,
  outputLimits,
  trackedExec,
  contextDiagnostics,
  setupConfig,
  setupCore,
  auroraState,
  auroraUi,
  auroraFooter,
  resilience,
  recoveryState,
  verifierPolicy,
  sessionHealthAnalyze,
  sessionHealth,
  openrouterDoctor,
};

for (const name of Object.keys(SECTION_SUITES)) {
  const run = sections[name];
  if (typeof run !== "function") {
    throw new Error(`No section implementation registered for ${name}.`);
  }
  await run(context);
}

// Invoke an accidentally unregistered exported section as well. Its section()
// call records the missing suite instead of letting the section disappear from
// filtered and aggregate runs.
for (const [name, run] of Object.entries(sections)) {
  if (!Object.hasOwn(SECTION_SUITES, name)) await run(context);
}

assert(
  unknownSections.size === 0,
  "every section has an explicit suite — missing: " +
    [...unknownSections].join(", "),
);

const { passed, failed } = counters();
console.log(
  "\n" +
    (failed === 0 ? "PASS" : "FAIL") +
    ": " +
    passed +
    " passed, " +
    failed +
    " failed",
);
if (failed > 0) process.exitCode = 1;
