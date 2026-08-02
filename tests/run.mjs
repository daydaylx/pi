// Regression tests for the minimal Pi extension stack.
//
// The real TypeScript modules are loaded through jiti; no generated build
// artifact is needed for the test harness.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import {
  assert,
  counters,
  eq,
  recordThrow,
  setCurrentSection,
} from "./shared/assertions.mjs";
import {
  assertNoGlobalChrome,
  contrastRatio,
  createHarness,
  latestStatus,
  stripAnsi,
} from "./shared/harness.mjs";
import { ROOT, importModule } from "./shared/jiti-loader.mjs";

// Every section is assigned its domain explicitly. The previous catch-all
// ("everything else is workflow") silently absorbed unrelated sections and
// would have let a renamed or newly added section drop out of every filtered
// run unnoticed — unknownSections below now makes that a hard failure.
//
// Workflow-specific behavior is covered by tests/workflow-mode.mjs; this
// runner owns only the remaining runtime, UI, LSP and diff sections.
const SECTION_SUITES = {
  "target runtime configuration": "runtime",
  "greenfield setup config and Aurora state contract": "runtime",
  "setup core lifecycle": "runtime",
  "project verification profiles (#105)": "runtime",
  "native subagent profiles": "runtime",
  "native project skills": "runtime",
  "global control plane shortcuts": "runtime",
  "shared output limits and subagent guard": "runtime",
  "ask-user temporary dialog": "runtime",
  "Aurora UI lifecycle and responsive surfaces": "runtime",
  "combined production extension stack": "runtime",
  "Control Center menus and routing": "ui",
  "shared menu shell navigation and rendering": "ui",
  "LSP Control Center file picker": "lsp",
  "LSP transport, process and lifecycle (#93)": "lsp",
  "LSP config, root detection, registry and profiles (#94)": "lsp",
  "LSP documents and diagnostics (#95)": "lsp",
  "LSP security and registry single-flight (P0.2, P1.1)": "lsp",
  "LSP navigation and symbol tools (#96)": "lsp",
  "LSP command, status and trust (#97)": "lsp",
  "diff viewer regressions": "diff",
};

const TEST_SUITES = new Set(Object.values(SECTION_SUITES));
const requestedSuite = process.env.PI_TEST_SUITE;
if (requestedSuite && !TEST_SUITES.has(requestedSuite)) {
  throw new Error(
    `Unknown PI_TEST_SUITE ${requestedSuite}; expected one of ${[...TEST_SUITES].join(", ")}.`,
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

const policy = await load("extensions/shared/permission-policy.ts");
const menuUi = await load("extensions/shared/menu-ui.ts");
const thinkingMenu = await load("extensions/shared/thinking-menu.ts");
const lspControlCenter = await load("extensions/lsp/control-center.ts");
const lspTools = await load("extensions/lsp/tools.ts");
const modePermissions = await load("extensions/mode-permissions.ts");
const planMode = await load("extensions/plan-mode/index.ts");
const controlPlane = await load("extensions/control-plane.ts");
const diffAlgorithm = await load("extensions/diff-viewer/diff-algorithm.ts");
const diffFallback = await load("extensions/diff-viewer/git-diff.ts");
const diffTracker = await load("extensions/diff-viewer/change-tracker.ts");
const diffViewer = await load("extensions/diff-viewer/index.ts");
const askUser = await load("extensions/ask-user.ts");
const askUserPolicy = await load("extensions/shared/ask-user-policy.ts");
const lspExtensionMod = await load("extensions/lsp/index.ts");
const outputLimits = await load("extensions/shared/output-limits.ts");
const toolOutputGuard = await load("extensions/tool-output-guard.ts");
const setupConfig = await load("extensions/setup-core/config.ts");
const setupCore = await load("extensions/setup-core/index.ts");
const auroraState = await load("extensions/aurora-ui/state.ts");
const auroraUi = await load("extensions/aurora-ui/index.ts");

// ─────────────────── target runtime and exclusive ownership ───────────────────
await section("target runtime configuration", async () => {
  const settings = JSON.parse(
    readFileSync(path.join(ROOT, "settings.json"), "utf8"),
  );
  const keybindings = JSON.parse(
    readFileSync(path.join(ROOT, "keybindings.json"), "utf8"),
  );
  const subagentConfig = JSON.parse(
    readFileSync(
      path.join(ROOT, "extensions", "subagent", "config.json"),
      "utf8",
    ),
  );
  const packageJson = JSON.parse(
    readFileSync(path.join(ROOT, "npm", "package.json"), "utf8"),
  );
  const lock = JSON.parse(
    readFileSync(path.join(ROOT, "npm", "package-lock.json"), "utf8"),
  );

  // Aurora is the only supported runtime chrome in this test suite.
  if (settings.theme === "aurora-night") {
    const setup = JSON.parse(
      readFileSync(path.join(ROOT, "setup.json"), "utf8"),
    );
    const schema = JSON.parse(
      readFileSync(path.join(ROOT, "schemas", "setup.schema.json"), "utf8"),
    );
    const auroraTheme = JSON.parse(
      readFileSync(path.join(ROOT, "themes", "aurora-night.json"), "utf8"),
    );
    const packageSources = settings.packages.map((entry) =>
      typeof entry === "string" ? entry : entry?.source,
    );
    eq(
      packageSources.length,
      1,
      "only subagent orchestration remains an active package",
    );
    assert(
      /^git:github\.com\/daydaylx\/pi-subagents@[0-9a-f]{40}$/.test(
        packageSources[0] ?? "",
      ),
      "subagent runtime remains immutable-pinned",
    );
    eq(
      settings.subagents,
      { disableBuiltins: true },
      "settings directly disable package-built-in agent profiles",
    );
    assert(
      !Object.hasOwn(setup, "models"),
      "setup.json contains no duplicate model-role configuration",
    );
    const defaultModelId = `${settings.defaultProvider}/${settings.defaultModel}`;
    assert(
      settings.enabledModels.includes(defaultModelId),
      `the active default model (${defaultModelId}) is contained in Pi's scoped models`,
    );
    eq(
      setup.ui,
      { theme: "aurora-night", motion: "contextual" },
      "central UI defaults",
    );
    eq(
      setup.permissions,
      {
        unknownTools: "ask",
        bash: "allow",
        workflowDefaults: {
          work: "project-write",
          simple_plan: "readonly",
          detailed_plan: "readonly",
        },
      },
      "unknown tools and free bash fail to confirmation",
    );
    eq(
      keybindings["tui.editor.yank"],
      "super+shift+y",
      "editor yank leaves Super+Y available for the YOLO toggle",
    );
    eq(
      schema.additionalProperties,
      false,
      "central setup schema rejects unknown root keys",
    );
    eq(
      auroraTheme.name,
      "aurora-night",
      "Aurora theme has its stable runtime name",
    );
    eq(
      auroraTheme.vars.dim,
      "#7384AA",
      "Aurora dim uses the accessible P2 contrast color",
    );
    assert(
      contrastRatio(auroraTheme.vars.dim, auroraTheme.vars.navy) >= 4.5 &&
        contrastRatio(auroraTheme.vars.dim, auroraTheme.vars.surface) >= 4.5,
      "Aurora dim meets AA contrast on both default backgrounds",
    );
    for (const color of [
      "accent",
      "borderAccent",
      "success",
      "warning",
      "error",
      "thinkingXhigh",
    ]) {
      assert(Boolean(auroraTheme.colors?.[color]), `Aurora declares ${color}`);
    }

    // Pi's theme schema sets additionalProperties:false and Theme.fg/bg throw on
    // unknown keys. A key the schema does not know therefore does not fail
    // loudly — it fails inside whatever try/catch happens to wrap the call. This
    // is the check that would have caught the invented "pillBg".
    const themeSchema = JSON.parse(
      readFileSync(
        path.join(
          ROOT,
          "npm/node_modules/@earendil-works/pi-coding-agent/dist",
          "modes/interactive/theme/theme-schema.json",
        ),
        "utf8",
      ),
    );
    const schemaColors = themeSchema.properties?.colors ?? {};
    const declaredColors = Object.keys(schemaColors.properties ?? {});
    assert(
      declaredColors.length > 0,
      "the Pi theme schema exposes its color properties",
    );
    eq(
      schemaColors.additionalProperties,
      false,
      "the Pi theme schema rejects unknown color keys",
    );
    for (const color of Object.keys(auroraTheme.colors ?? {})) {
      assert(
        declaredColors.includes(color),
        `Aurora color ${color} exists in the Pi theme schema`,
      );
    }
    for (const required of schemaColors.required ?? []) {
      assert(
        Object.hasOwn(auroraTheme.colors ?? {}, required),
        `Aurora declares the required color ${required}`,
      );
    }

    // The three former UI packages are inactive (see the pin assertions below),
    // so their configuration steered nothing. ADR 009 deleted it; these two
    // assertions are the stronger statement over "is unused".
    for (const deadConfig of [
      "zentui.json",
      "extensions/pi-tool-display/config.json",
    ]) {
      assert(
        !existsSync(path.join(ROOT, deadConfig)),
        `${deadConfig} does not return as dead configuration`,
      );
    }

    // renderPill reached for a background through an `as never` cast, which is
    // exactly how the invalid key survived the typechecker.
    const uiTheme = readFileSync(
      path.join(ROOT, "extensions/shared/ui-theme.ts"),
      "utf8",
    );
    assert(
      !/as never/.test(uiTheme) && !/\.bg\(/.test(uiTheme),
      "shared chrome helpers type their theme colors instead of casting them away",
    );

    const activeExtensions = settings.extensions.filter(
      (entry) => typeof entry === "string" && entry.startsWith("+extensions/"),
    );
    eq(
      activeExtensions,
      [
        "+extensions/setup-core/index.ts",
        "+extensions/plan-mode/index.ts",
        "+extensions/mode-permissions.ts",
        "+extensions/lsp/index.ts",
        "+extensions/ask-user.ts",
        "+extensions/tool-output-guard.ts",
        "+extensions/diff-viewer/index.ts",
        "+extensions/control-plane.ts",
        "+extensions/aurora-ui/index.ts",
      ],
      "settings declare the dependency-safe local extension order",
    );
    for (const extension of [
      "+extensions/setup-core/index.ts",
      "+extensions/plan-mode/index.ts",
      "+extensions/mode-permissions.ts",
      "+extensions/ask-user.ts",
      "+extensions/lsp/index.ts",
      "+extensions/tool-output-guard.ts",
      "+extensions/aurora-ui/index.ts",
    ]) {
      assert(activeExtensions.includes(extension), `${extension} is active`);
    }
    // Aurora is the only UI owner: the pre-Aurora chrome files are gone from
    // the tree, not merely deactivated. Git history is their fallback.
    for (const legacyOwner of [
      "extensions/activity-status.ts",
      "extensions/thinking-view.ts",
      "extensions/thinking-view-config.ts",
      "extensions/git-header.ts",
      "extensions/context-menu.ts",
    ]) {
      assert(
        !existsSync(path.join(ROOT, legacyOwner)),
        `${legacyOwner} no longer exists under Aurora`,
      );
    }
    for (const extension of activeExtensions) {
      const sourcePath = path.join(ROOT, extension.slice(1));
      assert(existsSync(sourcePath), extension + " resolves to a local file");
      if (!existsSync(sourcePath)) continue;
      const source = readFileSync(sourcePath, "utf8");
      const ownsChrome =
        /\.(?:setFooter|setEditorComponent|setWidget|setHeader)\s*\(/.test(
          source,
        );
      if (extension === "+extensions/aurora-ui/index.ts") {
        assert(ownsChrome, "Aurora owns the custom TUI chrome");
        eq(
          (source.match(/\bsetInterval\s*\(/g) ?? []).length,
          1,
          "Aurora owns one shared contextual ticker",
        );
      } else {
        const isTemporaryDiffPreview =
          extension === "+extensions/diff-viewer/index.ts";
        if (isTemporaryDiffPreview) {
          assert(
            !/\.(?:setFooter|setEditorComponent|setHeader)\s*\(/.test(source),
            extension + " owns no permanent TUI chrome",
          );
          assert(
            source.includes("setWidget(LIVE_PREVIEW_WIDGET, undefined)"),
            extension + " clears its temporary live-preview widget",
          );
        } else {
          assert(!ownsChrome, extension + " does not compete for TUI chrome");
        }
        assert(
          !/\bsetInterval\s*\(/.test(source),
          extension + " has no UI ticker",
        );
      }
    }
    eq(
      subagentConfig.parallel,
      { maxTasks: 4, concurrency: 3 },
      "active package config directly bounds subagent tasks and concurrency",
    );
    eq(
      subagentConfig.globalConcurrencyLimit,
      3,
      "active package config directly bounds global concurrency",
    );
    eq(
      subagentConfig.maxSubagentSpawnsPerSession,
      12,
      "active package config directly bounds spawns per session",
    );
    eq(
      setup.subagents,
      { concurrency: 3 },
      "setup.json supplies only the concurrency baseline",
    );
    eq(
      schema.properties.subagents.required,
      ["concurrency"],
      "setup schema requires only the concurrency baseline",
    );
    eq(
      schema.properties.subagents.properties,
      { concurrency: { type: "integer", minimum: 1, maximum: 8 } },
      "setup schema exposes no runtime package limits",
    );
    eq(
      subagentConfig.parallel.concurrency,
      setup.subagents.concurrency,
      "active package concurrency matches the setup baseline",
    );
    const installerSource = readFileSync(
      path.join(ROOT, "scripts", "install-user.mjs"),
      "utf8",
    );
    for (const required of [
      '"package.json"',
      '"tsconfig.json"',
      '"npm/package.json"',
      '"npm/package-lock.json"',
      '"tests"',
    ]) {
      assert(
        installerSource.includes(required),
        `greenfield installer includes verification support ${required}`,
      );
    }
    for (const workflow of ["verify.yml", "lsp-smoke.yml"]) {
      const source = readFileSync(
        path.join(ROOT, ".github", "workflows", workflow),
        "utf8",
      );
      assert(
        /actions\/checkout@11bd71901bbe5b1630ceea73d27597364c9af683/.test(
          source,
        ),
        `${workflow} pins actions/checkout to its v4.2.2 commit`,
      );
      assert(
        /actions\/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020/.test(
          source,
        ),
        `${workflow} pins actions/setup-node to its v4.4.0 commit`,
      );
      assert(
        !/uses:\s*actions\/(?:checkout|setup-node)@v\d/.test(source),
        `${workflow} has no mutable checkout/setup-node tag`,
      );
    }

    // Exact harness pins remain installed for deterministic typechecking even
    // though the three former UI packages are not active runtime packages.
    for (const [name, version] of [
      ["pi-zentui", "0.3.0"],
      ["pi-tool-display", "0.5.0"],
      ["@ujjwalgrover/pi-catppuccin", "1.0.0"],
      ["pi-subagents", "0.34.0"],
    ]) {
      eq(
        packageJson.dependencies?.[name],
        version,
        name + " remains exact in the harness",
      );
      eq(
        lock.packages?.["node_modules/" + name]?.version,
        version,
        name + " remains locked",
      );
    }
    return;
  }
});

await section("greenfield setup config and Aurora state contract", async () => {
  if (!setupConfig || !auroraState) return;
  const defaults = setupConfig.defaultSetupConfig();
  eq(
    defaults.ui,
    { theme: "aurora-night", motion: "contextual" },
    "Aurora is the central UI default",
  );
  eq(
    defaults.permissions,
    {
      unknownTools: "ask",
      bash: "allow",
      workflowDefaults: {
        work: "project-write",
        simple_plan: "readonly",
        detailed_plan: "readonly",
      },
    },
    "capability defaults require confirmation",
  );
  assert(
    !Object.hasOwn(defaults, "models"),
    "native Pi scoped models replace setup roles",
  );

  const project = mkdtempSync(path.join(tmpdir(), "pi-setup-config-"));
  mkdirSync(path.join(project, ".pi"), { recursive: true });
  writeFileSync(
    path.join(project, ".pi", "setup.json"),
    JSON.stringify({
      ui: { motion: "reduced" },
      permissions: {
        unknownTools: "allow",
        bash: "allow",
        workflowDefaults: { work: "full-access" },
      },
      lsp: { requestTimeoutMs: 5000 },
    }),
  );
  const trusted = setupConfig.loadSetupConfig(project, true);
  eq(trusted.config.ui.motion, "reduced", "trusted project may reduce motion");
  eq(
    trusted.config.lsp.requestTimeoutMs,
    5000,
    "trusted project may tune LSP timeout",
  );
  eq(
    trusted.config.permissions,
    {
      ...defaults.permissions,
      workflowDefaults: {
        ...defaults.permissions.workflowDefaults,
        work: "confirm-all",
      },
    },
    "project may not relax global permissions",
  );
  assert(
    trusted.diagnostics.some((entry) => entry.level === "warning"),
    "security relaxation produces a visible warning",
  );
  rmSync(project, { recursive: true, force: true });

  const state = {
    sessionEpoch: "epoch-1",
    workflow: { phase: "work", label: "Work" },
    permissions: {},
    lsp: {},
    model: {},
    activity: { kind: "idle", activeTools: 0 },
  };
  auroraState.mergeAuroraUiState(state, {
    workflow: {
      phase: "simple_plan",
      label: "Schnellplan",
    },
    lsp: { state: "ready" },
  });
  eq(state.workflow.phase, "simple_plan", "Aurora merges workflow modes");
  // Unknown legacy phases are ignored.
  auroraState.mergeAuroraUiState(state, { workflow: { phase: "executing" } });
  eq(
    state.workflow.phase,
    "simple_plan",
    "Aurora rejects the retired legacy phase name",
  );
  eq(state.workflow.completed, undefined, "Aurora has no workflow progress metadata");
  eq(state.lsp.state, "ready", "Aurora merges LSP patches");
  assert(
    auroraState.isAuroraUiStateRequest({
      type: "request",
      requestId: "request-1",
      sessionEpoch: "epoch-1",
      requester: "test",
    }),
    "Aurora validates state requests",
  );
});

await section("setup core lifecycle", async () => {
  if (!setupCore) return;
  const harness = createHarness();
  setupCore.default(harness.api);
  const context = harness.makeContext();
  await harness.runHooks("session_start", {}, context);
  assert(
    Boolean(harness.tools.get("verify")),
    "setup core registers the allowlisted verify tool",
  );
  assert(
    !harness.commands.get("verify-gate"),
    "setup core no longer owns /verify-gate; it belongs to the completion domain",
  );
  const doctor = harness.commands.get("setup-doctor");
  assert(Boolean(doctor), "/setup-doctor is registered");
  if (doctor) await doctor("", context);
  assert(
    harness.notifications.at(-1)?.message?.startsWith("Setup Doctor"),
    "setup doctor reports effective configuration without mutation",
  );
  assert(
    harness.notifications
      .at(-1)
      ?.message?.includes("Pi CLI/dev package: 0.80.7/0.82.1") &&
      harness.notifications.at(-1)?.level === "error",
    "setup doctor makes CLI/dev version drift visible",
  );
  assert(
    harness.notifications
      .at(-1)
      ?.message?.includes(
        "project verification profiles: keine .pi/verify.json",
      ),
    "setup doctor reports the project verification profile status (#105)",
  );
  assert(
    harness.notifications
      .at(-1)
      ?.message?.includes("subagent baseline (setup.json): concurrency=3") &&
      harness.notifications
        .at(-1)
        ?.message?.includes(
          "active subagent package config: concurrency=3, globalConcurrencyLimit=3",
        ),
    "setup doctor distinguishes the setup baseline from active package config",
  );
  assert(
    !harness.notifications.at(-1)?.message?.includes("doom-loop status:") &&
      !harness.notifications.at(-1)?.message?.includes("edit metrics:"),
    "setup doctor omits removed automatic doom-loop and edit-metric workflows",
  );
  assert(
    !harness.notifications.at(-1)?.message?.includes("recovery status:"),
    "setup doctor leaves workflow recovery to the explicit v3 controller",
  );
  const verify = harness.tools.get("verify");
  if (verify) {
    await verify.execute(
      "verify-safe-cwd",
      { check: "typecheck" },
      undefined,
      undefined,
      context,
    );
    eq(
      harness.execCalls.at(-1)?.options?.cwd,
      ROOT,
      "verify runs the setup's fixed command from the agent directory",
    );
  }
  assertNoGlobalChrome(harness, "setup core owns no TUI chrome");
});

// ---------------------------------------------------------------------------
// Trust-gated project verification profiles (#105). Foundation for the
// universal verification gate (#102); separate from the inviolable setup
// `verify` tool. No real process is spawned (exec is injected).
// ---------------------------------------------------------------------------
await section("project verification profiles (#105)", async () => {
  const profilesMod = await load("extensions/setup-core/verify-profiles.ts");
  assert(
    typeof profilesMod?.loadVerifyProfiles === "function",
    "verify-profiles exports loadVerifyProfiles",
  );
  assert(
    typeof profilesMod?.runProfile === "function",
    "verify-profiles exports runProfile",
  );
  assert(
    typeof profilesMod?.resolveProfileCwd === "function",
    "verify-profiles exports resolveProfileCwd",
  );

  const workspace = mkdtempSync(path.join(tmpdir(), "pi-verify-profiles-"));
  const cfgDir = path.join(workspace, ".pi");
  mkdirSync(cfgDir, { recursive: true });
  const cfgPath = path.join(cfgDir, "verify.json");

  function writeConfig(obj) {
    writeFileSync(cfgPath, JSON.stringify(obj));
  }
  function clearConfig() {
    try {
      rmSync(cfgPath, { force: true });
    } catch {
      /* ignore */
    }
  }

  // --- Trust gate: untrusted ignores .pi/verify.json ---
  writeConfig({
    profiles: {
      tests: {
        program: "pytest",
        args: ["-q"],
        timeoutMs: 30000,
      },
    },
  });
  const untrusted = profilesMod.loadVerifyProfiles(workspace, false);
  eq(
    Object.keys(untrusted.profiles).length,
    0,
    "untrusted project loads no verification profiles",
  );
  eq(
    untrusted.diagnostics.some(
      (d) => d.level === "warning" && d.message.includes("trusted"),
    ),
    true,
    "untrusted project gets a clear 'ignored until trusted' diagnostic",
  );

  // --- Trust gate: trusted loads valid profiles ---
  const trusted = profilesMod.loadVerifyProfiles(workspace, true);
  eq(
    Object.keys(trusted.profiles),
    ["tests"],
    "trusted project loads the declared profile",
  );
  eq(trusted.profiles.tests.program, "pytest", "program preserved");
  eq(trusted.profiles.tests.args, ["-q"], "args preserved as array");
  eq(trusted.profiles.tests.required, true, "required defaults to true");
  eq(
    trusted.profiles.tests.trustRequired,
    true,
    "trustRequired defaults to true",
  );
  eq(trusted.profiles.tests.cwd, ".", "cwd defaults to '.'");

  // --- Missing file yields no profiles and no diagnostics ---
  clearConfig();
  const missing = profilesMod.loadVerifyProfiles(workspace, true);
  eq(Object.keys(missing.profiles).length, 0, "missing file -> no profiles");
  eq(missing.diagnostics.length, 0, "missing file -> no diagnostics");

  // --- Schema: unknown top-level key is rejected ---
  writeConfig({
    unexpected: 1,
    profiles: { tests: { program: "pytest", args: [] } },
  });
  let res = profilesMod.loadVerifyProfiles(workspace, true);
  eq(
    res.diagnostics.some((d) =>
      d.message.includes("unbekannter Schlüssel 'unexpected'"),
    ),
    true,
    "unknown top-level key is reported",
  );
  eq(Object.keys(res.profiles), ["tests"], "valid profile still loads");

  // --- Schema: unknown profile key drops the profile (fail-closed) ---
  writeConfig({
    profiles: {
      bad: { program: "x", args: [], oops: true },
      good: { program: "y", args: ["--fast"] },
    },
  });
  res = profilesMod.loadVerifyProfiles(workspace, true);
  eq(
    Object.keys(res.profiles),
    ["good"],
    "profile with unknown key is dropped",
  );
  eq(
    res.diagnostics.some(
      (d) => d.message.includes("profiles.bad") && d.message.includes("oops"),
    ),
    true,
    "unknown profile key is reported with path",
  );

  // --- Schema: invalid program / args / timeoutMs / env ---
  writeConfig({
    profiles: {
      noProgram: { args: [] },
      emptyProgram: { program: "   ", args: [] },
      badArgs: { program: "x", args: "not-array" },
      nonStringArg: { program: "x", args: [1] },
      hugeTimeout: { program: "x", args: [], timeoutMs: 9_000_000 },
      badEnv: { program: "x", args: [], env: { K: 1 } },
    },
  });
  res = profilesMod.loadVerifyProfiles(workspace, true);
  eq(
    Object.keys(res.profiles),
    [],
    "every schema violation drops its profile (fail-closed)",
  );
  const msgs = res.diagnostics.map((d) => d.message).join("\n");
  for (const needle of [
    "noProgram.program",
    "badArgs.args",
    "nonStringArg.args",
    "hugeTimeout.timeoutMs",
    "badEnv.env",
  ]) {
    assert(msgs.includes(needle), "diagnostic names " + needle);
  }

  // --- resolveProfileCwd: relative ok, absolute/escape rejected ---
  const root = workspace;
  eq(
    profilesMod.resolveProfileCwd(root, "."),
    root,
    "'.' resolves to the project root",
  );
  eq(
    profilesMod.resolveProfileCwd(root, "sub/dir"),
    path.join(root, "sub", "dir"),
    "relative subdir resolves under the project root",
  );
  eq(
    profilesMod.resolveProfileCwd(root, "/etc"),
    null,
    "absolute cwd is rejected",
  );
  eq(
    profilesMod.resolveProfileCwd(root, "../escape"),
    null,
    "parent traversal is rejected",
  );

  // --- runProfile: program + args passed separately (no shell string) ---
  const seen = [];
  const recordingExec = async (program, args, options) => {
    seen.push({ program, args, options });
    return { code: 0, stdout: "ok", stderr: "", killed: false };
  };
  const profile = {
    program: "pytest",
    args: ["-q", "--maxfail=1"],
    cwd: ".",
    timeoutMs: 30_000,
    required: true,
    env: {},
    trustRequired: true,
  };
  const okRun = await profilesMod.runProfile(profile, {
    projectRoot: root,
    exec: recordingExec,
  });
  eq(okRun.ok, true, "exit 0 -> ok");
  eq(seen[0].program, "pytest", "exec receives the program name");
  eq(
    seen[0].args,
    ["-q", "--maxfail=1"],
    "exec receives args as a separate array (no shell string)",
  );
  eq(seen[0].options.cwd, root, "exec runs in the bounded project root");
  eq(typeof seen[0].options.env, "object", "exec receives an env object");
  eq(
    seen[0].options.env.PATH !== undefined,
    true,
    "profile env is additive on top of process.env (PATH inherited)",
  );

  // --- runProfile: non-zero exit -> not ok, structured error ---
  const failRun = await profilesMod.runProfile(profile, {
    projectRoot: root,
    exec: async () => ({ code: 2, stdout: "", stderr: "boom", killed: false }),
  });
  eq(failRun.ok, false, "non-zero exit -> not ok");
  eq(failRun.exitCode, 2, "exit code captured");
  eq(
    failRun.error.kind,
    "spawn_failed",
    "non-zero exit reported as spawn_failed",
  );

  // --- runProfile: timeout -> killed, structured timeout error ---
  const timeoutRun = await profilesMod.runProfile(profile, {
    projectRoot: root,
    exec: async () => ({ code: null, stdout: "", stderr: "", killed: true }),
  });
  eq(timeoutRun.ok, false, "killed -> not ok");
  eq(timeoutRun.killed, true, "killed flag surfaced");
  eq(timeoutRun.error.kind, "timeout", "timeout reported as timeout");

  // --- runProfile: missing binary (ENOENT) -> missing_binary, no crash ---
  const missingRun = await profilesMod.runProfile(profile, {
    projectRoot: root,
    exec: async () => {
      throw Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" });
    },
  });
  eq(missingRun.ok, false, "missing binary -> not ok");
  eq(
    missingRun.error.kind,
    "missing_binary",
    "ENOENT classified as missing_binary",
  );

  // --- runProfile: cwd bounding honored at run time ---
  const escapeRun = await profilesMod.runProfile(
    { ...profile, cwd: "../escape" },
    {
      projectRoot: root,
      exec: async () => ({ code: 0, stdout: "", stderr: "", killed: false }),
    },
  );
  eq(escapeRun.ok, false, "escaping cwd is not executed");
  eq(
    escapeRun.error.kind,
    "spawn_failed",
    "escaping cwd reported as spawn_failed with a clear message",
  );
  eq(seen.length, 1, "escaping cwd prevented the exec call entirely");

  try {
    rmSync(workspace, { recursive: true, force: true });
  } catch {
    /* ignore temp cleanup */
  }
});

/** Gate exec stub whose typecheck step fails; used by the sections below. */

await section("native subagent profiles", async () => {
  const expectedProfiles = ["planner.md", "reviewer.md", "worker.md"];
  const agentsRoot = path.join(ROOT, "agents");
  eq(
    readdirSync(agentsRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => entry.name)
      .sort(),
    expectedProfiles,
    "planner, worker and reviewer are the complete local core role set",
  );
  const profileSources = Object.fromEntries(
    expectedProfiles.map((name) => [
      name,
      readFileSync(path.join(agentsRoot, name), "utf8"),
    ]),
  );
  const expectedTools = {
    "planner.md": "read, grep, find, ls",
    "reviewer.md": "read, grep, find, ls",
    "worker.md": "read, grep, find, ls, edit, write, bash",
  };
  for (const [name, source] of Object.entries(profileSources)) {
    assert(
      source.includes(`tools: ${expectedTools[name]}`),
      `${name} declares its exact runtime tool boundary`,
    );
    assert(
      source.includes("defaultContext: fresh") &&
        source.includes("inheritProjectContext: true") &&
        source.includes("inheritSkills: false"),
      `${name} starts with fresh context without inherited skills`,
    );
    assert(
      !/^tools:.*\b(?:task|delegate|spawn)\b/m.test(source),
      `${name} cannot perform nested delegation`,
    );
  }
  for (const name of ["planner.md", "reviewer.md"]) {
    assert(
      !/^tools:.*\b(?:edit|write|bash)\b/m.test(profileSources[name]),
      `${name} remains read-only`,
    );
  }
  assert(
    /^tools:.*\bedit\b.*\bwrite\b.*\bbash\b/m.test(
      profileSources["worker.md"],
    ),
    "worker exclusively owns write and shell tools",
  );
  for (const activeDoc of [
    "AGENTS.md",
    "README.md",
    "docs/subagents.md",
  ]) {
    const source = readFileSync(path.join(ROOT, activeDoc), "utf8");
    const retiredRole = "(?:scout|oracle|test-runner)";
    const optionalCodeTick = "[`]?";
    const historicalMarker =
      /\b(?:frühere?[nr]?|historisch(?:e[nsr]?|en)?|retired|inaktiv|nicht\s+(?:aktiv|ausführbar|installiert)|entfernt)\b/i;
    const executableRecommendation = new RegExp(
      [
        `\\|\\s*${optionalCodeTick}${retiredRole}${optionalCodeTick}\\s*\\|`,
        `\\b(?:verwende|nutze|delegiere|starte|wähle|übergebe)\\s+(?:an\\s+)?${optionalCodeTick}${retiredRole}${optionalCodeTick}\\b`,
        `\\b${retiredRole}\\b\\s*(?:→|ist\\s+(?:nötig|zuständig)|führt|prüft|implementiert)`,
      ].join("|"),
      "i",
    );
    for (const paragraph of source.split(/\n\s*\n/)) {
      if (!new RegExp(`\\b${retiredRole}\\b`, "i").test(paragraph))
        continue;
      assert(
        historicalMarker.test(paragraph),
        `${activeDoc} marks a historical retired-role mention as inactive`,
      );
      assert(
        !executableRecommendation.test(paragraph),
        `${activeDoc} does not recommend a retired role for execution`,
      );
    }
  }
  assert(
    !/COMPLETION-REVIEW|completion request's marker contract/i.test(
      profileSources["reviewer.md"],
    ),
    "reviewer has no automatic completion-marker contract",
  );
});

await section("native project skills", async () => {
  const expectedSkills = [
    "agent-docs",
    "bug-triage",
    "context-checkpoint",
    "doc-diff",
    "git-check",
    "lsp-navigation",
    "prompt-compiler",
    "release-changelog",
    "repo-analyse",
    "security-audit",
    "test-ci",
    "ui-ux-review",
  ];
  const skillsRoot = path.join(ROOT, "skills");
  eq(
    readdirSync(skillsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort(),
    expectedSkills,
    "the twelve project skills use Pi's standard skill directories",
  );

  for (const name of expectedSkills) {
    const skillPath = path.join(skillsRoot, name, "SKILL.md");
    assert(existsSync(skillPath), name + " has a native SKILL.md file");
    if (!existsSync(skillPath)) continue;
    const source = readFileSync(skillPath, "utf8");
    assert(
      new RegExp(
        "^---\\nname: " +
          name +
          '\\ndescription: (?:\\"[^\\n]+\\"|[^\\n]+)\\n---\\n',
      ).test(source),
      name + " has Pi-compatible name and description frontmatter",
    );
    assert(
      !/^allowed-tools:/m.test(source),
      name +
        " does not present experimental allowed-tools as a security boundary",
    );
  }
});

// ─────────────────────── security and plan helpers ───────────────────────
// Doom-Loop- und Edit-Fallback-Module wurden entfernt: sie waren seit 4c7a201
// von keiner Extension mehr geladen (setup-core/index.ts importierte sie nicht)
// und damit wirkungslos. Ihre Tests entfallen mit ihnen.

await section("Control Center menus and routing", async () => {
  if (!thinkingMenu || !modePermissions || !planMode || !controlPlane) return;

  // Two entry points, different scope, one definition: Shift+Tab is the
  // workflow switch, Super+Q the full Control Center whose first tab IS that
  // workflow switch. Both route through plan-mode's single action router, so
  // a workflow entry can never differ between them.
  {
    const seen = [];
    const shared = createHarness({
      select: (labels) => {
        seen.push([...labels]);
        return undefined;
      },
    });
    planMode.default(shared.api);
    controlPlane.default(shared.api);
    const sharedContext = shared.makeContext({
      cwd: mkdtempSync(path.join(tmpdir(), "pi-cc-entries-")),
    });
    sharedContext.ui.custom = async () => {
      throw new Error("use deterministic select fallback");
    };
    await shared.runHooks("session_start", {}, sharedContext);
    await shared.shortcuts.get("shift+tab")(sharedContext);
    await shared.shortcuts.get("super+q")(sharedContext);
    // Super+Q routes through an event; the bus dispatches without awaiting the
    // async listener, so let the microtask queue drain before asserting.
    await new Promise((resolve) => setImmediate(resolve));
    eq(seen.length, 2, "both entry points opened their menu");
    const [workflowSwitch, controlCenter] = seen;
    eq(
      workflowSwitch,
      [
        "Work",
        "Schnellplan",
        "Architekturplan",
      ],
      "Shift+Tab exposes only the three workflow modes",
    );
    assert(
      controlCenter.length > workflowSwitch.length &&
        controlCenter.includes("Workflow wechseln · /workflow") &&
        controlCenter.includes("Berechtigungsmodus · /permission") &&
        controlCenter.includes("LSP-Steuerung · /lsp"),
      "Super+Q exposes the canonical workflow, permission and LSP commands",
    );
  }

  const thinkingEntries = thinkingMenu.buildThinkingMenu("high", "auto");
  eq(
    thinkingEntries[0].value,
    "auto",
    "Thinking menu starts with explicit Auto",
  );
  assert(
    thinkingEntries.some((entry) => entry.value === "manual:xhigh"),
    "Thinking menu exposes manual levels distinctly",
  );

  const cwd = mkdtempSync(path.join(tmpdir(), "pi-control-center-"));
  try {
    let choice = "Manuell: Sehr hoch";
    const harness = createHarness({
      select: (labels) => {
        if (choice === "__thinking__")
          return labels.find((label) => label.endsWith("Denken: Auto (high)"));
        if (choice === "__permissions__")
          return labels.find((label) =>
            label.endsWith("Berechtigungen: Lesen + Schreiben"),
          );
        if (choice === "__diagnostics__")
          return labels.find((label) => label.endsWith("LSP-Diagnose"));
        if (choice === "__models__") {
          return labels.find((label) =>
            label.endsWith("openai-codex/gpt-5.4-mini"),
          );
        }
        return labels.find((label) => label === choice);
      },
      models: {
        "openai-codex/gpt-5.4-mini": {
          provider: "openai-codex",
          id: "gpt-5.4-mini",
        },
      },
    });
    planMode.default(harness.api);
    modePermissions.default(harness.api);
    controlPlane.default(harness.api);
    const context = harness.makeContext({
      cwd,
      model: { provider: "openai-codex", id: "gpt-5.4", thinkingLevelMap: {} },
    });
    context.ui.custom = async () => {
      throw new Error("use deterministic select fallback");
    };
    await harness.runHooks("session_start", {}, context);
    assert(
      !harness.shortcuts.has("ctrl+shift+x"),
      "Ctrl+Shift+X registers no local shortcut",
    );
    assert(
      !harness.shortcuts.has("ctrl+shift+y"),
      "legacy permission shortcut is retired",
    );
    assert(harness.shortcuts.has("super+d"), "Super+D opens Thinking");
    assert(harness.shortcuts.has("super+m"), "Super+M opens models");

    choice = "Manuell: Sehr hoch";
    await harness.shortcuts.get("super+d")(context);
    eq(
      harness.api.getThinkingLevel(),
      "xhigh",
      "manual Thinking selection applies its level",
    );
    choice = "Schnellplan";
    await harness.shortcuts.get("shift+tab")(context);
    eq(
      harness.api.getThinkingLevel(),
      "xhigh",
      "manual Thinking survives a workflow transition",
    );
    choice = "Auto";
    await harness.shortcuts.get("super+d")(context);
    eq(
      harness.api.getThinkingLevel(),
      "medium",
      "Auto restores the active workflow default",
    );
    choice = "Architekturplan";
    await harness.shortcuts.get("shift+tab")(context);
    eq(
      harness.api.getThinkingLevel(),
      // detailed_plan maps to "high" since 4c7a201 (the retired MODE_THINKING
      // table used "xhigh"); what matters here is that Auto follows at all.
      "high",
      "Auto follows later workflow transitions",
    );

    let staleThinkingContext;
    let staleThinkingHarness;
    staleThinkingHarness = createHarness({
      thinkingLevel: "low",
      select: async (labels) => {
        await staleThinkingHarness.runHooks(
          "session_start",
          {},
          staleThinkingContext,
        );
        return labels.find((label) => label === "Manuell: Sehr hoch");
      },
    });
    modePermissions.default(staleThinkingHarness.api);
    controlPlane.default(staleThinkingHarness.api);
    staleThinkingContext = staleThinkingHarness.makeContext({ cwd });
    staleThinkingContext.ui.custom = async () => {
      throw new Error("use deterministic select fallback");
    };
    await staleThinkingHarness.runHooks(
      "session_start",
      {},
      staleThinkingContext,
    );
    await staleThinkingHarness.shortcuts.get("super+d")(staleThinkingContext);
    eq(
      staleThinkingHarness.api.getThinkingLevel(),
      "low",
      "a Thinking selection from the previous session cannot change the new session",
    );
    assert(
      staleThinkingHarness.appended.every(
        (entry) => entry.data?.thinkingMode !== "manual",
      ),
      "a stale Thinking selection is not persisted in the new session",
    );

    choice = "__models__";
    await harness.shortcuts.get("super+m")(context);
    eq(
      harness.submittedCommands.at(-1),
      "/model",
      "Super+M delegates model selection to Pi's canonical /model command",
    );

    const busy = createHarness({
      idle: false,
      models: {
        "openai-codex/gpt-5.4-mini": {
          provider: "openai-codex",
          id: "gpt-5.4-mini",
        },
      },
      select: (labels) =>
        labels.find((label) => label.endsWith("openai-codex/gpt-5.4-mini")),
    });
    planMode.default(busy.api);
    controlPlane.default(busy.api);
    const busyContext = busy.makeContext({ cwd });
    busyContext.ui.custom = async () => {
      throw new Error("use deterministic select fallback");
    };
    await busy.shortcuts.get("super+m")(busyContext);
    eq(
      busy.submittedCommands,
      ["/model"],
      "the shortcut keeps using Pi's canonical model command while busy",
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

await section("global control plane shortcuts", async () => {
  if (!controlPlane) return;
  const harness = createHarness({
    select: (labels) =>
      labels.includes("LSP-Diagnose") ? "LSP-Diagnose" : undefined,
  });
  controlPlane.default(harness.api);
  const context = harness.makeContext();
  context.ui.custom = async () => {
    throw new Error("use deterministic select fallback");
  };
  const openMainMenu = harness.shortcuts.get("super+q");
  assert(Boolean(openMainMenu), "Super+Q registers the global main menu");
  if (openMainMenu) await openMainMenu(context);
  eq(
    harness.submittedCommands,
    ["/commands"],
    "Super+Q submits the canonical /commands entry point",
  );
  eq(
    harness.emitted,
    [],
    "the control plane owns shortcuts only and needs no parallel menu event",
  );
});

await section("LSP Control Center file picker", async () => {
  if (!lspControlCenter) return;
  assert(
    typeof lspTools?.runLspDiagnostics === "function",
    "Control Center reuses the exported diagnostics execution path",
  );
  const cwd = mkdtempSync(path.join(tmpdir(), "pi-lsp-picker-"));
  try {
    writeFileSync(path.join(cwd, "ok.ts"), "export {}\n");
    mkdirSync(path.join(cwd, "node_modules"));
    writeFileSync(path.join(cwd, "node_modules", "ignored.ts"), "export {}\n");
    symlinkSync(path.join(cwd, "ok.ts"), path.join(cwd, "linked.ts"));
    eq(
      lspControlCenter.findLspDiagnosticCandidates(cwd),
      ["ok.ts"],
      "LSP picker accepts regular supported workspace files and skips symlinks/ignored directories",
    );
    eq(
      lspControlCenter.findLspDiagnosticCandidates(path.join(cwd, "missing")),
      [],
      "LSP picker has a clear empty candidate result",
    );
    eq(
      lspControlCenter.resolveLspDiagnosticCandidate(cwd, "ok.ts"),
      path.join(cwd, "ok.ts"),
      "LSP picker revalidates a regular selected file before diagnosis",
    );
    eq(
      lspControlCenter.resolveLspDiagnosticCandidate(cwd, "linked.ts"),
      undefined,
      "LSP picker rejects a selected symlink after enumeration",
    );

    let sessionCurrent = true;
    const lifecycleHarness = createHarness({
      select: (labels) => {
        if (labels.includes("Datei prüfen")) return "Datei prüfen";
        sessionCurrent = false;
        return labels.includes("ok.ts") ? "ok.ts" : undefined;
      },
    });
    lspControlCenter.registerLspControlCenter(lifecycleHarness.api, {
      getStatus: () => "leerlauf",
      refreshStatus() {
        throw new Error("stale picker must not refresh LSP status");
      },
      captureSession: () => "session-1",
      isSessionCurrent: () => sessionCurrent,
      captureDeps() {
        throw new Error("stale picker must not start LSP diagnostics");
      },
    });
    const lifecycleContext = lifecycleHarness.makeContext({ cwd });
    lifecycleContext.ui.custom = async () => {
      throw new Error("use deterministic select fallback");
    };
    await lifecycleHarness.dispatchEvent("control-center:open-diagnostics", {
      ctx: lifecycleContext,
    });
    eq(
      lifecycleHarness.notifications,
      [],
      "stale LSP pickers stop before diagnostics or UI updates",
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

await section("shared output limits and subagent guard", async () => {
  if (!outputLimits || !toolOutputGuard) return;
  const largeText = [
    "HEAD_SENTINEL",
    ...Array.from(
      { length: outputLimits.DEFAULT_MAX_LINES + 500 },
      (_, index) => `line-${index}`,
    ),
    "TAIL_SENTINEL",
  ].join("\n");
  const limited = outputLimits.limitTextOutput(largeText);
  assert(Boolean(limited.truncation), "oversized text is visibly truncated");
  assert(
    limited.text.startsWith("HEAD_SENTINEL") &&
      limited.text.endsWith("TAIL_SENTINEL"),
    "balanced truncation retains both beginning and end",
  );
  assert(
    limited.text.includes("[Ausgabe gekürzt:"),
    "balanced truncation includes a visible marker",
  );
  assert(
    Buffer.byteLength(limited.text, "utf8") <= outputLimits.DEFAULT_MAX_BYTES,
    "balanced truncation stays within Pi's byte limit",
  );
  assert(
    limited.truncation.outputLines <= outputLimits.DEFAULT_MAX_LINES,
    "balanced truncation stays within Pi's line limit",
  );

  const utf8SingleLine =
    "HEAD_UTF8_SENTINEL-" + "😀".repeat(40_000) + "-TAIL_UTF8_SENTINEL";
  const limitedUtf8 = outputLimits.limitTextOutput(utf8SingleLine);
  const actualUtf8Bytes = Buffer.byteLength(limitedUtf8.text, "utf8");
  const actualUtf8Lines = limitedUtf8.text.endsWith("\n")
    ? limitedUtf8.text.split("\n").length - 1
    : limitedUtf8.text.split("\n").length;
  assert(
    limitedUtf8.text.startsWith("HEAD_UTF8_SENTINEL-") &&
      limitedUtf8.text.endsWith("-TAIL_UTF8_SENTINEL"),
    "a long single UTF-8 line retains both head and tail sentinels",
  );
  assert(
    !limitedUtf8.text.includes("�"),
    "partial single-line truncation never splits a UTF-8 code point",
  );
  assert(
    actualUtf8Bytes <= outputLimits.DEFAULT_MAX_BYTES,
    "single-line UTF-8 truncation stays within Pi's byte limit",
  );
  eq(
    limitedUtf8.truncation.outputBytes,
    actualUtf8Bytes,
    "single-line truncation reports its actual byte count",
  );
  eq(
    limitedUtf8.truncation.outputLines,
    actualUtf8Lines,
    "single-line truncation reports its actual line count",
  );

  const harness = createHarness();
  toolOutputGuard.default(harness.api);
  const unconstrainedCall = {
    type: "tool_call",
    toolCallId: "subagent-unbounded",
    toolName: "subagent",
    input: { agent: "scout", task: "inspect" },
  };
  await harness.runHooks("tool_call", unconstrainedCall, harness.makeContext());
  eq(
    unconstrainedCall.input.maxOutput,
    undefined,
    "the guard leaves package-side subagent output settings untouched",
  );

  const strictCall = {
    type: "tool_call",
    toolCallId: "subagent-strict",
    toolName: "subagent",
    input: {
      agent: "scout",
      task: "inspect",
      maxOutput: { bytes: 4096, lines: 100 },
    },
  };
  await harness.runHooks("tool_call", strictCall, harness.makeContext());
  eq(
    strictCall.input.maxOutput,
    { bytes: 4096, lines: 100 },
    "the guard does not mutate caller-provided subagent limits",
  );

  const details = { runId: "child-1", artifact: "/tmp/result.json" };
  const guardedResult = (
    await harness.runHooks(
      "tool_result",
      {
        type: "tool_result",
        toolCallId: "subagent-result",
        toolName: "subagent",
        input: {},
        content: [{ type: "text", text: largeText }],
        details,
        isError: true,
      },
      harness.makeContext(),
    )
  )[0];
  assert(
    guardedResult.content[0].text.includes("[Ausgabe gekürzt:"),
    "the subagent result backstop visibly truncates oversized text",
  );
  assert(
    guardedResult.content[0].text.startsWith("HEAD_SENTINEL") &&
      guardedResult.content[0].text.endsWith("TAIL_SENTINEL"),
    "the subagent result backstop preserves explicit head and tail sentinels",
  );
  eq(guardedResult.details, details, "the backstop preserves result details");
  eq(guardedResult.isError, true, "the backstop preserves isError");

  const unrelated = await harness.runHooks(
    "tool_result",
    {
      type: "tool_result",
      toolCallId: "other-result",
      toolName: "other",
      input: {},
      content: [{ type: "text", text: largeText }],
      details: undefined,
      isError: false,
    },
    harness.makeContext(),
  );
  eq(
    unrelated[0],
    undefined,
    "the output guard does not alter non-subagent tool results",
  );

  const lspTools = await load("extensions/lsp/tools.ts");
  const lspCwd = mkdtempSync(path.join(tmpdir(), "pi-lsp-output-limit-"));
  try {
    writeFileSync(path.join(lspCwd, "tsconfig.json"), "{}");
    writeFileSync(path.join(lspCwd, "large.ts"), "export const value = 1;\n");
    const profile = {
      id: "typescript",
      label: "Bounded TypeScript",
      enabled: true,
      command: "unused",
      args: [],
      rootMarkers: ["tsconfig.json"],
    };
    const config = {
      enabled: true,
      mode: "auto",
      requestTimeoutMs: 1000,
      idleShutdownMs: 1000,
      workspaceSymbolLimit: 50,
      languages: { typescript: profile },
    };
    const oversizedError = Array.from(
      { length: outputLimits.DEFAULT_MAX_LINES + 500 },
      (_, index) => `server-error-${index}`,
    ).join("\n");
    const lspHarness = createHarness();
    lspTools.registerLspDiagnosticsTool(lspHarness.api, {
      getConfig: () => config,
      getRegistry: () => ({
        async acquire() {
          throw new Error(oversizedError);
        },
        release() {},
      }),
    });
    const lspResult = await lspHarness.tools
      .get("lsp_diagnostics")
      .execute(
        "large-lsp-result",
        { path: "large.ts" },
        undefined,
        undefined,
        lspHarness.makeContext({ cwd: lspCwd }),
      );
    assert(
      lspResult.content[0].text.includes("[Ausgabe gekürzt:"),
      "LSP text results use the shared visible output boundary",
    );
    eq(
      lspResult.details?.truncation?.strategy,
      "balanced-head-tail",
      "LSP details identify output truncation without hiding semantic metadata",
    );
  } finally {
    rmSync(lspCwd, { recursive: true, force: true });
  }
});

// ───────────────── temporary dialogs and narrow terminals ─────────────────
await section("ask-user temporary dialog", async () => {
  if (!askUser || !askUserPolicy) return;
  eq(
    askUserPolicy.hasValidQuestionOptionCount(2),
    true,
    "ask_user accepts two options",
  );
  eq(
    askUserPolicy.hasValidQuestionOptionCount(4),
    true,
    "ask_user accepts four options",
  );
  eq(
    askUserPolicy.hasValidQuestionOptionCount(5),
    false,
    "ask_user rejects five options",
  );
  eq(askUserPolicy.digitSelection("2", 2), 2, "direct digit selection works");
  eq(
    askUserPolicy.digitSelection("3", 2),
    undefined,
    "digits never select the custom-input row",
  );

  const harness = createHarness({ columns: 24 });
  askUser.default(harness.api);
  const tool = harness.tools.get("ask_user");
  assert(Boolean(tool), "ask_user is registered");
  if (!tool) return;
  const context = harness.makeContext();
  const params = {
    question:
      "Welche sichere Option soll bei schmalem Terminal gewählt werden?",
    why: "Die Auswahl muss ohne globale UI funktionieren.",
    options: [
      {
        label: "Lesen",
        description: "Nur prüfen.",
        effort: "niedrig",
        risk: "niedrig",
      },
      {
        label: "Planen",
        description: "Einen strukturierten Plan vorbereiten.",
        effort: "mittel",
        risk: "niedrig",
      },
    ],
    recommendedIndex: 2,
    recommendationReason: "Eine klare nächste Entscheidung.",
  };
  const pending = tool.execute(
    "ask-user-test",
    params,
    undefined,
    undefined,
    context,
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  const component = harness.customComponents.at(-1);
  assert(Boolean(component), "ask_user opens a temporary native dialog");
  if (!component) return;
  assert(
    component.render(24).every((line) => stripAnsi(line).length <= 24),
    "ask_user renders within a narrow 24-column terminal",
  );
  component.handleInput("2");
  const result = await pending;
  eq(result.details.answer, "Planen", "keyboard selection returns the choice");
  eq(result.details.selectedIndex, 2, "selected index remains one-based");
  assertNoGlobalChrome(harness, "ask_user uses no global editor or widget");

  const nonTui = createHarness();
  askUser.default(nonTui.api);
  const nonTuiTool = nonTui.tools.get("ask_user");
  for (const mode of ["json", "print", "rpc"]) {
    const resultForMode = await nonTuiTool.execute(
      "ask-user-non-tui",
      params,
      undefined,
      undefined,
      nonTui.makeContext({ mode, hasUI: false }),
    );
    assert(
      resultForMode.content[0].text.includes(
        "benötigt den interaktiven TUI-Modus",
      ),
      "ask_user returns a structured error in " + mode + " mode",
    );
  }
  eq(nonTui.customComponents.length, 0, "ask_user opens no dialog outside TUI");
});

await section("shared menu shell navigation and rendering", async () => {
  if (!menuUi) return;
  eq(
    menuUi.initialMenuIndex([
      { id: "disabled", label: "Blockiert", disabled: true },
      { id: "active", label: "Aktiv", current: true },
    ]),
    1,
    "initial menu selection skips disabled entries",
  );
  eq(
    menuUi.moveMenuIndex(1, 1, [
      { id: "disabled", label: "Blockiert", disabled: true },
      { id: "active", label: "Aktiv" },
      { id: "last", label: "Letzter" },
    ]),
    2,
    "menu movement skips disabled entries",
  );
  const viewport = menuUi.calculateMenuViewport([1, 3, 1, 1], 1, 0, 3);
  eq(
    viewport.start <= 1 && viewport.end > 1,
    true,
    "viewport keeps selected multi-line entry visible",
  );
  eq(
    menuUi.menuOverlayWidth(80, "ANSI \u001b[31mTitel\u001b[0m", []),
    menuUi.menuOverlayWidth(80, "界界界", []),
    "overlay width does not use raw ANSI or grapheme string length",
  );

  const harness = createHarness({ columns: 120, rows: 40 });
  const context = harness.makeContext();
  const pending = menuUi.runMenu(context, "Hauptmenü", [
    {
      id: "area",
      label: "Bereich",
      description: "Untermenü mit einer ausführlichen Beschreibung",
      children: [
        {
          id: "go",
          label: "Ausführen",
          description: "Sichere explizite Aktion",
          value: "go",
        },
        {
          id: "disabled",
          label: "Blockiert",
          description: "Darf nicht ausgeführt werden",
          disabled: true,
          disabledReason: "Nicht verfügbar",
        },
      ],
    },
  ]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const component = harness.customComponents.at(-1);
  assert(Boolean(component), "shared menu opens a temporary overlay");
  if (!component) return;
  for (const width of [30, 50, 80, 120]) {
    const lines = component.render(width);
    assert(
      lines.every((line) => stripAnsi(line).length <= width),
      `menu frame remains within ${width} columns`,
    );
    assert(
      stripAnsi(lines[0]).startsWith("╭"),
      `menu has a complete top frame at ${width} columns`,
    );
    assert(
      lines.every((line) => !stripAnsi(line).includes(" · ")),
      `menu footer hint at ${width} columns uses the themed separator, not a raw dot`,
    );
  }
  component.handleInput("\r");
  assert(
    component
      .render(80)
      .some((line) => stripAnsi(line).includes("Hauptmenü › Bereich")),
    "opening a submenu renders a breadcrumb",
  );
  component.handleInput("\r");
  eq(
    await pending,
    "go",
    "Enter selects only the explicit focused leaf action",
  );
  assertNoGlobalChrome(harness, "menu shell installs no permanent chrome");
});

await section("Aurora UI lifecycle and responsive surfaces", async () => {
  if (!auroraUi) return;
  const harness = createHarness({ sessionName: "aurora-test" });
  auroraUi.default(harness.api);

  // Stands in for permissions/session-state.ts, the only extension that knows
  // the permission mode. Aurora seeds no label of its own any more, so without
  // a provider the footer must say so rather than invent one.
  harness.api.events.on("aurora-ui/state/request", (value) => {
    if (value?.requester !== "aurora-ui") return;
    harness.api.events.emit("aurora-ui/state/snapshot", {
      type: "snapshot",
      requestId: value.requestId,
      sessionEpoch: value.sessionEpoch,
      source: "permissions-test-provider",
      state: {
        workflow: { phase: "working", label: "Schritt 1/3" },
        permissions: { level: "project-write", label: "Projekt schreiben" },
      },
    });
  });

  const context = harness.makeContext({
    cwd: path.join(homedir(), "projects", "aurora-test"),
  });
  const discovered = await harness.runHooks("resources_discover", {}, context);
  assert(
    discovered.some((entry) =>
      entry?.themePaths?.some((value) => value.endsWith("aurora-night.json")),
    ),
    "Aurora exposes its theme through resource discovery",
  );
  await harness.runHooks("session_start", {}, context);
  eq(
    context.ui.theme.name,
    "aurora-night",
    "Aurora activates its central theme",
  );
  eq(
    harness.chrome,
    { footer: 1, editor: 1, widget: 1, header: 0 },
    "Aurora is the single custom chrome owner",
  );
  assert(Boolean(harness.footerFactory), "Aurora installs a footer factory");
  assert(Boolean(harness.editorFactory), "Aurora installs an editor factory");

  // A second consumer asks for the current state. Aurora answers on the
  // snapshot channel — the contract aurora-ui/README.md documents.
  {
    const answers = [];
    const stopListening = harness.api.events.on(
      "aurora-ui/state/snapshot",
      (value) => {
        if (value?.source === "aurora-ui") answers.push(value);
      },
    );
    const request = harness.emitted.find(
      (entry) => entry.name === "aurora-ui/state/request",
    )?.event;
    assert(Boolean(request), "Aurora announces a session epoch on start");
    harness.api.events.emit("aurora-ui/state/request", {
      type: "request",
      requestId: "control-center:1",
      sessionEpoch: request?.sessionEpoch,
      requester: "control-center",
    });
    eq(
      answers.length,
      1,
      "Aurora answers a foreign state request exactly once",
    );
    eq(
      answers[0]?.requestId,
      "control-center:1",
      "the snapshot carries the requester's id",
    );
    harness.api.events.emit("aurora-ui/state/request", {
      type: "request",
      requestId: "stale:1",
      sessionEpoch: "epoch-from-a-previous-session",
      requester: "control-center",
    });
    eq(answers.length, 1, "Aurora ignores a request from a stale epoch");
    stopListening?.();
  }

  if (harness.footerFactory) {
    let onBranchChange;
    const footer = harness.footerFactory(
      { requestRender() {} },
      context.ui.theme,
      {
        getGitBranch: () => "feature/aurora",
        getExtensionStatuses: () =>
          new Map([
            ["workflow", "ARBEIT 1/3"],
            ["permissions", "Read + Write"],
            ["lsp", "ready"],
          ]),
        onBranchChange: (listener) => {
          onBranchChange = listener;
          return () => {
            onBranchChange = undefined;
          };
        },
      },
    );
    for (const width of [60, 90, 140]) {
      assert(
        footer.render(width).every((line) => stripAnsi(line).length <= width),
        `Aurora footer fits ${width} columns`,
      );
    }
    assert(
      stripAnsi(footer.render(140)[0]).includes(
        `~${path.sep}projects${path.sep}aurora-test`,
      ),
      "Aurora footer shows the current directory as a compact home-relative path",
    );

    const wide = stripAnsi(footer.render(140)[0]);
    const narrow = stripAnsi(footer.render(60)[0]);

    // The permission mode comes from the Aurora bus. The "permissions" status
    // key carries a risk banner sized for dialogs, not for a footer segment.
    assert(
      wide.includes("Projekt schreiben") && !wide.includes("Read + Write"),
      "Aurora footer shows the permission mode from the bus, not the status banner",
    );
    assert(
      narrow.includes("Projekt schreiben"),
      "the permission mode survives the narrowest layout",
    );

    // Segments give up their place whole rather than being shaved off at the
    // edge, so what remains stays readable.
    assert(
      wide.includes("Denken") && !narrow.includes("Denken"),
      "Aurora footer drops the thinking segment before it crowds a narrow line",
    );

    // The editor frame is the only surface allowed to show workflow status
    // (decision 009). The footer must never echo the "workflow" status key,
    // even in the wide layout that has room for it.
    assert(
      !wide.includes("ARBEIT 1/3"),
      "Aurora footer no longer duplicates the workflow status from the editor frame",
    );

    // renderPill's bracket fallback fired on every render because "pillBg" is
    // not a key the Pi theme schema knows.
    assert(
      !/[[\]]/.test(wide) && !/[[\]]/.test(narrow),
      "Aurora footer segments are colored, not bracketed",
    );
    assert(
      !wide.includes(" · ") && !narrow.includes(" · "),
      "Aurora footer never falls back to an unstyled separator",
    );

    const wideLines = footer.render(140).map(stripAnsi);
    eq(
      wideLines.filter((line) => line.includes("Kontext")).length,
      1,
      "context is reported exactly once, on the second wide line",
    );
    assert(
      !wideLines.some((line) => line.includes("Konf ")),
      "the second footer line spells out Kontext",
    );
    const readsAfterFirstWideRender = harness.branchReads;
    footer.render(140);
    eq(
      harness.branchReads,
      readsAfterFirstWideRender,
      "Aurora reuses token totals across unchanged footer renders",
    );
    onBranchChange?.();
    footer.render(140);
    eq(
      harness.branchReads,
      readsAfterFirstWideRender + 1,
      "Aurora recomputes token totals exactly once after a branch change",
    );
    footer.dispose?.();
  }

  // The editor frame carries workflow and step only. Everything durable moved
  // to the footer, so a status value must never appear on both surfaces.
  if (harness.editorFactory) {
    const identity = (value) => value;
    const editor = harness.editorFactory(
      {
        requestRender() {},
        write() {},
        terminal: { rows: 40, columns: 140 },
      },
      {
        borderColor: identity,
        selectList: {
          text: identity,
          selectedText: identity,
          description: identity,
          scrollIndicator: identity,
        },
      },
      { onAction() {}, get: () => undefined },
    );
    const framed = editor.render(140).map(stripAnsi);
    const frame = framed.find((line) => line.startsWith("╭"));
    assert(Boolean(frame), "the editor keeps exactly one frame line on top");
    assert(
      !framed.some((line) => line.startsWith("╰")),
      "the lower frame line is gone with the values it used to carry",
    );
    assert(
      frame?.includes("Schritt"),
      "the editor frame names the current step",
    );
    for (const duplicated of ["Denken", "Kontext", "aurora-test-model"]) {
      assert(
        !frame?.includes(duplicated),
        `the editor frame leaves ${duplicated} to the footer`,
      );
    }
    editor.dispose?.();
  }

  await harness.runHooks("agent_start", {}, context);
  eq(
    harness.workingVisibility.at(-1),
    true,
    "Aurora shows contextual activity while working",
  );
  await harness.runHooks(
    "tool_execution_start",
    {
      toolCallId: "tool-aurora",
      toolName: "read",
      args: { path: "README.md" },
    },
    context,
  );
  const widget = harness.widgets.get("aurora-ui/activity")?.content;
  assert(
    typeof widget === "function",
    "Aurora activity widget is transient and component-backed",
  );
  if (typeof widget === "function") {
    const component = widget({ requestRender() {} }, context.ui.theme);
    assert(
      component.render(60).length >= 1,
      "Aurora activity renders in a narrow terminal",
    );
    // The specific activity text ("1 Tool aktiv") must live on exactly one
    // surface. The native working indicator stays generic; the widget above
    // the editor carries the specific text.
    eq(
      harness.workingMessages.at(-1),
      "Arbeite …",
      "the native working indicator stays generic while a tool runs",
    );
    assert(
      stripAnsi(component.render(60)[0]).includes("Tool"),
      "the specific activity text lives only in the activity widget",
    );
    component.dispose?.();
  }

  // A turn that ends while a tool is still registered must not leave the
  // activity surface claiming work. agent_end and agent_settled share one
  // handler, so both have to clear it.
  await harness.runHooks("agent_end", {}, context);
  eq(
    harness.workingVisibility.at(-1),
    false,
    "Aurora settles the activity surface when the turn ends",
  );
  eq(
    harness.widgets
      .get("aurora-ui/activity")
      ?.content({ requestRender() {} }, context.ui.theme)
      .render(140).length,
    0,
    "the activity widget renders nothing once the turn has settled",
  );
  await harness.runHooks("session_shutdown", {}, context);
  eq(harness.widgets.size, 0, "Aurora removes its widget on shutdown");
  eq(
    harness.workingVisibility.at(-1),
    false,
    "Aurora hides activity on shutdown",
  );
  eq(
    context.ui.theme.name,
    "test-theme",
    "Aurora restores the previous theme on shutdown",
  );
});

await section("combined production extension stack", async () => {
  if (
    !modePermissions ||
    !planMode ||
    !setupCore ||
    !askUser ||
    !lspExtensionMod ||
    !toolOutputGuard ||
    !diffViewer ||
    !controlPlane ||
    !auroraUi
  )
    return;
  const factoryByExtension = {
    "+extensions/setup-core/index.ts": setupCore.default,
    "+extensions/plan-mode/index.ts": planMode.default,
    "+extensions/mode-permissions.ts": modePermissions.default,
    "+extensions/lsp/index.ts": lspExtensionMod.default,
    "+extensions/ask-user.ts": askUser.default,
    "+extensions/tool-output-guard.ts": toolOutputGuard.default,
    "+extensions/diff-viewer/index.ts": diffViewer.default,
    "+extensions/control-plane.ts": controlPlane.default,
    "+extensions/aurora-ui/index.ts": auroraUi.default,
  };
  const settings = JSON.parse(
    readFileSync(path.join(ROOT, "settings.json"), "utf8"),
  );
  const activeExtensions = settings.extensions.filter(
    (entry) => typeof entry === "string" && entry.startsWith("+extensions/"),
  );
  eq(
    activeExtensions,
    Object.keys(factoryByExtension),
    "combined stack activates exactly the configured local entry points",
  );
  const factories = activeExtensions.map(
    (extension) => factoryByExtension[extension],
  );
  const harness = createHarness();
  for (const factory of factories) factory(harness.api);
  // A dedicated cwd keeps this test isolated from any real .agent/plans/
  // current-plan.md that may exist at ROOT (this repo's own working state),
  // which would otherwise push plan-mode into "draft" and flip the expected
  // "WORK" workflow status below.
  const cwd = mkdtempSync(path.join(tmpdir(), "pi-combined-stack-"));
  const context = harness.makeContext({ cwd });
  await harness.runHooks("session_start", {}, context);
  eq(
    harness.chrome,
    { footer: 1, editor: 1, widget: 1, header: 0 },
    "combined stack gives Aurora exclusive ownership of custom chrome",
  );
  eq(harness.duplicateTools, [], "combined stack has no duplicate local tools");
  eq(
    [...harness.tools.keys()].sort(),
    [
      "ask_user",
      "lsp_definition",
      "lsp_diagnostics",
      "lsp_hover",
      "lsp_references",
      "lsp_workspace_symbols",
      "verify",
    ],
    "only local functional tools register locally",
  );
  eq(
    latestStatus(harness, "permissions"),
    "🛡 DEFAULT · PROJECT WRITE",
    "the workflow default is visible in the shared footer",
  );
  eq(
    latestStatus(harness, "workflow"),
    "Work",
    "combined stack publishes workflow",
  );
  eq(
    harness.workingVisibility.at(-1),
    false,
    "combined stack starts without a permanent activity widget",
  );
  eq(
    latestStatus(harness, "lsp"),
    "leerlauf",
    "combined stack publishes an idle lsp status with no active servers",
  );
  const lspCommand = harness.commands.get("lsp");
  assert(Boolean(lspCommand), "/lsp is registered");
  if (lspCommand) await lspCommand("off", context);
  eq(
    latestStatus(harness, "lsp"),
    "aus",
    "the session-local LSP override can disable LSP",
  );
  await harness.runHooks("session_shutdown", {}, context);
  eq(
    latestStatus(harness, "lsp"),
    undefined,
    "session_shutdown clears the lsp status",
  );
  const nextContext = harness.makeContext({ cwd, sessionId: "next-session" });
  await harness.runHooks("session_start", {}, nextContext);
  eq(
    latestStatus(harness, "lsp"),
    "leerlauf",
    "a new session does not inherit the previous LSP override",
  );
  await harness.runHooks("session_shutdown", {}, nextContext);

  for (const mode of ["json", "print", "rpc"]) {
    const nonTui = createHarness();
    for (const factory of factories) factory(nonTui.api);
    const contextForMode = nonTui.makeContext({ mode, hasUI: false });
    await nonTui.runHooks("session_start", {}, contextForMode);
    eq(
      nonTui.statusCalls,
      [],
      "combined stack produces no status output in " + mode + " mode",
    );
    assertNoGlobalChrome(
      nonTui,
      "combined stack installs no chrome in " + mode + " mode",
    );
  }
});

// ---------------------------------------------------------------------------
// LSP transport, process and lifecycle (#93). Deterministic: uses the local
// fake-lsp fixture only, never a real language server or the network.
// ---------------------------------------------------------------------------
const FAKE_LSP_COMMAND = "python3";
const FAKE_LSP_FIXTURE = path.join(ROOT, "tests", "fixtures", "fake-lsp.py");

await section("LSP transport, process and lifecycle (#93)", async () => {
  const transportMod = await load("extensions/lsp/transport.ts");
  const clientMod = await load("extensions/lsp/client.ts");
  const indexMod = await load("extensions/lsp/index.ts");
  const typesMod = await load("extensions/lsp/types.ts");
  const toolsMod = await load("extensions/lsp/tools.ts");
  assert(
    typeof transportMod?.parseStreamChunk === "function",
    "lsp transport exports parseStreamChunk",
  );
  assert(
    typeof clientMod?.LspClient === "function",
    "lsp client exports LspClient",
  );
  assert(
    typeof indexMod?.createLspClient === "function",
    "lsp index exports createLspClient",
  );

  await check("formatErrorMessage and LspError formatting handles RPC errors cleanly", async () => {
    const { formatErrorMessage } = clientMod;
    const { LspError } = typesMod;
    const { formatLspError } = toolsMod;

    eq(
      formatErrorMessage(new Error("std error")),
      "std error",
      "formatErrorMessage unpacks Error instance",
    );
    eq(
      formatErrorMessage({ code: -32601, message: "Method not found" }),
      "Method not found",
      "formatErrorMessage unpacks JSON-RPC error object",
    );
    eq(
      formatErrorMessage({ message: "custom obj message" }),
      "custom obj message",
      "formatErrorMessage unpacks object with message property",
    );

    const lspErr = new LspError({
      kind: "request_failed",
      serverId: "typescript",
      workspaceRoot: "/home/d/.pi/agent",
      method: "workspace/symbol",
      cause: "Method workspace/symbol not supported",
    });

    eq(lspErr.cause, "Method workspace/symbol not supported", "LspError stores cause property");
    eq(lspErr.toStructured().cause, "Method workspace/symbol not supported", "toStructured returns cause without header prefix");

    const formatted = formatLspError(lspErr);
    assert(
      !formatted.includes("[object Object]"),
      "formatted error does not contain [object Object]",
    );
    assert(
      formatted.includes("Ursache: Method workspace/symbol not supported"),
      "formatted error shows concise cause without duplicate header",
    );
  });

  const fakeServer = FAKE_LSP_FIXTURE;
  const workspace = mkdtempSync(path.join(tmpdir(), "pi-lsp-test-"));
  const trackedClients = [];

  function makeClient(extra = {}) {
    const {
      args: extraArgs = [],
      process: extraProcess,
      command = FAKE_LSP_COMMAND,
      ...rest
    } = extra;
    const client = new clientMod.LspClient({
      serverId: "fake",
      workspaceRoot: workspace,
      command,
      args:
        command === FAKE_LSP_COMMAND ? [fakeServer, ...extraArgs] : extraArgs,
      requestTimeoutMs: 1000,
      process: {
        maxRestarts: 1,
        backoffBaseMs: 40,
        backoffMaxMs: 80,
        shutdownGraceMs: 400,
        ...extraProcess,
      },
      ...rest,
    });
    trackedClients.push(client);
    return client;
  }

  async function check(name, fn) {
    try {
      await fn();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      assert(false, name + " threw: " + detail);
    }
  }

  async function settle(client) {
    try {
      await client.shutdown();
    } catch {
      /* best-effort cleanup */
    }
  }

  function frame(message) {
    const body = Buffer.from(JSON.stringify(message), "utf8");
    const header = Buffer.from(
      `Content-Length: ${body.length}\r\n\r\n`,
      "utf8",
    );
    return Buffer.concat([header, body]);
  }

  await check("framing parses coalesced and fragmented messages", async () => {
    const parse = transportMod.parseStreamChunk;
    const msg1 = { jsonrpc: "2.0", id: 1, method: "a", params: { n: 1 } };
    const msg2 = { jsonrpc: "2.0", method: "note", params: { x: 2 } };
    const msg3 = { jsonrpc: "2.0", id: 2, result: { ok: true } };
    const buf = Buffer.concat([frame(msg1), frame(msg2), frame(msg3)]);
    // Cut inside the first message body so the head is incomplete.
    const cut = frame(msg1).length - 3;
    const head = buf.subarray(0, cut);
    const tail = buf.subarray(cut);
    const first = parse(head);
    eq(first.messages.length, 0, "partial head yields no complete message");
    const second = parse(Buffer.concat([first.rest, tail]));
    eq(second.messages.length, 3, "tail completes all three messages");
    eq(second.rest.length, 0, "no trailing bytes remain");
    eq(second.messages[0].id, 1, "first message id correlates");
    eq(second.messages[2].result.ok, true, "third message result parsed");
  });

  await check("initialize handshake and a sample request", async () => {
    const client = makeClient();
    const result = await client.start();
    assert(
      result?.capabilities?.hoverProvider === true,
      "initialize returns server capabilities",
    );
    const echo = await client.request("test/echo", { hello: "world" });
    eq(echo.hello, "world", "test/echo returns the request params");
    await settle(client);
    assert(!client.processRunning, "no live process after shutdown");
  });

  await check("parallel requests correlate by id", async () => {
    const client = makeClient();
    await client.start();
    const replies = await Promise.all([
      client.request("test/parallel", { i: 1 }),
      client.request("test/parallel", { i: 2 }),
      client.request("test/parallel", { i: 3 }),
    ]);
    eq(
      replies.map((r) => r.i),
      [1, 2, 3],
      "each parallel request resolves with its own params",
    );
    await settle(client);
  });

  await check("request timeout yields a structured error", async () => {
    const client = makeClient({ args: ["--hang"] });
    await client.start();
    let caught;
    try {
      await client.request("test/echo", {}, { timeoutMs: 250 });
    } catch (error) {
      caught = error;
    }
    assert(Boolean(caught), "a hanging request rejects");
    eq(caught?.kind, "timeout", "error kind is timeout");
    eq(caught?.serverId, "fake", "error names the server id");
    await settle(client);
  });

  await check("cancellation yields a structured error", async () => {
    const client = makeClient({ args: ["--hang"] });
    await client.start();
    const ac = new AbortController();
    const promise = client.request(
      "test/echo",
      {},
      {
        signal: ac.signal,
        timeoutMs: 5000,
      },
    );
    setTimeout(() => ac.abort(), 40);
    let caught;
    try {
      await promise;
    } catch (error) {
      caught = error;
    }
    eq(caught?.kind, "cancelled", "error kind is cancelled");
    await settle(client);
  });

  await check("shutdown rejects in-flight requests promptly", async () => {
    const client = makeClient({ args: ["--hang"] });
    await client.start();
    const started = Date.now();
    const promise = client.request("test/echo", {}, { timeoutMs: 5000 });
    // Shut down while the request is still hanging; it must reject now, not
    // after the full 5s timeout (exercises transport close()/failAll).
    setTimeout(() => {
      client.shutdown().catch(() => undefined);
    }, 60);
    let caught;
    try {
      await promise;
    } catch (error) {
      caught = error;
    }
    const elapsed = Date.now() - started;
    assert(Boolean(caught), "in-flight request rejects on shutdown");
    assert(
      elapsed < 4000,
      "in-flight request rejects well before its 5s timeout (got " +
        elapsed +
        "ms)",
    );
    await settle(client);
  });

  await check("crash triggers a bounded restart then degrades", async () => {
    const client = makeClient({
      args: ["--crash-after-init"],
      process: {
        maxRestarts: 1,
        backoffBaseMs: 30,
        backoffMaxMs: 60,
        shutdownGraceMs: 400,
      },
    });
    let restarts = 0;
    client.on("restart", () => {
      restarts += 1;
    });
    const degraded = new Promise((resolve) =>
      client.once("degraded", () => resolve(true)),
    );
    await client.start(); // first init succeeds, server crashes right after
    await Promise.race([
      degraded,
      new Promise((r) => setTimeout(() => r(false), 2000)),
    ]);
    assert(restarts >= 1, "at least one automatic restart happened");
    eq(
      client.currentState,
      "degraded",
      "client degrades after bounded restart attempts",
    );
    await settle(client);
    assert(!client.processRunning, "no live process after degraded + shutdown");
  });

  await check(
    "missing binary yields a structured error without a crash",
    async () => {
      const client = makeClient({
        command: "pi-lsp-definitely-missing-binary-xyzzy",
        args: [],
      });
      let caught;
      try {
        await client.start();
      } catch (error) {
        caught = error;
      }
      assert(Boolean(caught), "a missing binary rejects start");
      eq(caught?.kind, "missing_binary", "error kind is missing_binary");
      assert(!client.processRunning, "no live process for a missing binary");
      await settle(client);
    },
  );

  // Defensive sweep: every client must be shut down with no process left.
  for (const client of trackedClients) {
    try {
      await client.shutdown();
    } catch {
      /* ignore */
    }
  }
  let liveCount = 0;
  for (const client of trackedClients) {
    if (client.processRunning) liveCount += 1;
  }
  eq(liveCount, 0, "no LSP client leaves a live process behind");

  try {
    rmSync(workspace, { recursive: true, force: true });
  } catch {
    /* ignore temp cleanup errors */
  }
});

// ---------------------------------------------------------------------------
// LSP config, root detection, registry and profiles (#94). Uses the fake-lsp
// fixture from #93; deterministic, no real language server or network.
// ---------------------------------------------------------------------------
await section(
  "LSP config, root detection, registry and profiles (#94)",
  async () => {
    const configMod = await load("extensions/lsp/config.ts");
    const rootsMod = await load("extensions/lsp/roots.ts");
    const profilesMod = await load("extensions/lsp/server-profiles.ts");
    const registryMod = await load("extensions/lsp/registry.ts");
    const capsMod = await load("extensions/lsp/capabilities.ts");

    assert(
      typeof configMod?.resolveConfig === "function",
      "lsp config exports resolveConfig",
    );
    assert(
      typeof rootsMod?.findWorkspaceRoot === "function",
      "lsp roots exports findWorkspaceRoot",
    );
    assert(
      profilesMod?.PROFILES?.typescript?.id === "typescript",
      "lsp server-profiles exports PROFILES",
    );
    assert(
      typeof registryMod?.ServerRegistry === "function",
      "lsp registry exports ServerRegistry",
    );
    assert(
      typeof capsMod?.normalizeCapabilities === "function",
      "lsp capabilities exports normalizeCapabilities",
    );

    const fakeServer = FAKE_LSP_FIXTURE;
    const workspace = mkdtempSync(path.join(tmpdir(), "pi-lsp94-test-"));

    function fakeProfile(extra = {}) {
      return {
        id: "fake",
        label: "Fake LSP",
        enabled: true,
        command: FAKE_LSP_COMMAND,
        args: [fakeServer, ...(extra.args ?? [])],
        rootMarkers: [],
        ...extra,
      };
    }

    // --- Config priority ---

    const defaults = {
      enabled: true,
      mode: "auto",
      requestTimeoutMs: 10000,
      idleShutdownMs: 600000,
      workspaceSymbolLimit: 50,
      languages: {},
    };
    const withTypeScript = { languages: { typescript: { enabled: true } } };

    assert(
      configMod.resolveConfig({
        defaults,
        trusted: true,
        sessionFlags: { mode: "force" },
      }).mode === "force",
      "session flag overrides mode",
    );
    assert(
      configMod.resolveConfig({
        defaults,
        trusted: true,
        sessionFlags: { requestTimeoutMs: 5000 },
      }).requestTimeoutMs === 5000,
      "session flag overrides timeout",
    );
    assert(
      configMod.resolveConfig({
        defaults,
        trusted: true,
        projectConfig: { mode: "off" },
        sessionFlags: { mode: "auto" },
      }).mode === "auto",
      "session wins over project",
    );
    assert(
      configMod.resolveConfig({
        defaults,
        trusted: true,
        projectConfig: { enabled: true },
      }).enabled === true,
      "project config applied when trusted",
    );
    assert(
      configMod.resolveConfig({
        defaults,
        trusted: false,
        projectConfig: { enabled: false },
      }).enabled === true,
      "untrusted ignores projectConfig (keeps defaults)",
    );
    assert(
      configMod.resolveConfig({
        defaults,
        trusted: false,
        projectConfig: { mode: "force" },
      }).mode === "auto",
      "untrusted ignores projectConfig mode",
    );

    // --- Root detection ---

    writeFileSync(path.join(workspace, "tsconfig.json"), "{}");
    const nested = path.join(workspace, "src", "lib");
    mkdirSync(nested, { recursive: true });
    assert(
      rootsMod.findWorkspaceRoot(path.join(nested, "index.ts"), [
        "tsconfig.json",
      ]) === workspace,
      "finds marker two levels up",
    );
    assert(
      rootsMod.findWorkspaceRoot(workspace, ["pyproject.toml"]) === undefined,
      "returns undefined when no marker exists",
    );

    // --- Server profile defaults ---

    const ts = profilesMod.PROFILES.typescript;
    assert(ts.enabled === true, "typescript profile is enabled by default");
    assert(
      ts.initializationOptions?.disableAutomaticTypingAcquisition === true,
      "typescript disables automatic type acquisition",
    );

    const rust = profilesMod.PROFILES.rust;
    assert(rust.enabled === true, "rust profile is enabled by default");
    assert(
      rust.settings?.["rust-analyzer"]?.cargo?.buildScripts?.enable === false,
      "rust disables cargo build scripts",
    );
    assert(
      rust.settings?.["rust-analyzer"]?.procMacro?.enable === false,
      "rust disables proc macros",
    );
    for (const id of ["go", "c", "java"]) {
      assert(
        profilesMod.PROFILES[id]?.enabled === false,
        `${id} profile is disabled by default`,
      );
    }

    // --- Capabilities normalisation ---

    const full = capsMod.normalizeCapabilities({
      hoverProvider: true,
      definitionProvider: { linkSupport: true },
      referencesProvider: false,
      // Correct LSP 3.17 shape: workspaceSymbolProvider is top-level, like
      // hoverProvider/definitionProvider (fixed as part of #96 — the
      // previous `workspace: { symbol: true }` shape never appears in a
      // real InitializeResult and made normalizeCapabilities() always
      // report workspaceSymbols as unsupported).
      workspaceSymbolProvider: true,
      textDocument: { textDocumentSync: 1 },
    });
    assert(full.hover === true, "boolean hoverProvider");
    assert(full.definition === true, "object definitionProvider (truthy)");
    assert(full.references === false, "explicit false referencesProvider");
    assert(full.workspaceSymbols === true, "top-level workspaceSymbolProvider");
    assert(full.textDocumentSync === 1, "textDocumentSync passed through");

    const empty = capsMod.normalizeCapabilities({});
    assert(
      empty.hover === false &&
        empty.definition === false &&
        empty.references === false,
      "empty object → all false",
    );

    // --- Registry: reuse the same instance ---

    const idleShort = 80;
    const reg = new registryMod.ServerRegistry({
      config: {
        ...defaults,
        idleShutdownMs: idleShort,
        requestTimeoutMs: 2000,
      },
    });

    const pf = fakeProfile();
    const a = await reg.acquire(workspace, pf);
    const pidA = a.client.pid;
    assert(typeof pidA === "number", "acquire starts a server");

    reg.release(workspace, pf.id);
    const b = await reg.acquire(workspace, pf);
    assert(b.client.pid === pidA, "same (root,serverId) reuses the instance");
    reg.release(workspace, pf.id);

    // --- Registry: idle shutdown ---

    const c = await reg.acquire(workspace, pf);
    reg.release(workspace, pf.id);
    await new Promise((r) => setTimeout(r, idleShort * 2 + 30));
    assert(reg.size === 0, "entry removed after idle shutdown");
    assert(
      !c.client.processRunning,
      "server process terminated after idle shutdown",
    );

    // --- Registry: active request prevents idle shutdown ---

    const d = await reg.acquire(workspace, pf);
    // Do not call release → activeRequests stays 1.
    await new Promise((r) => setTimeout(r, idleShort * 2 + 30));
    assert(reg.size === 1, "entry kept while active requests in flight");
    assert(d.client.processRunning, "server still alive with active requests");
    reg.release(workspace, pf.id);
    await new Promise((r) => setTimeout(r, idleShort * 2 + 30));
    assert(reg.size === 0, "entry removed after release + idle wait");

    // --- Registry: missing binary → structured error, no crash ---

    let missingErr;
    try {
      await reg.acquire(workspace, {
        ...pf,
        command: "pi-lsp-definitely-missing-binary-xyzzy",
        id: "missing",
      });
    } catch (error) {
      missingErr = error;
    }
    assert(
      missingErr?.kind === "missing_binary" ||
        missingErr?.kind === "spawn_error",
      `missing binary gives structured error (got ${missingErr?.kind})`,
    );
    assert(reg.size === 0, "no server registered for missing binary");

    // --- Registry: shutdownAll leaves no orphans ---

    const srv1 = await reg.acquire(workspace, { ...pf, id: "srv1" });
    const srv2 = await reg.acquire(workspace, { ...pf, id: "srv2" });
    assert(reg.size === 2, "two servers registered before shutdownAll");
    await reg.shutdownAll();
    assert(reg.size === 0, "no entries after shutdownAll");
    assert(!srv1.client.processRunning, "srv1 process terminated");
    assert(!srv2.client.processRunning, "srv2 process terminated");

    // Defensive sweep.
    await reg.shutdownAll();
    try {
      rmSync(workspace, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  },
);

// ---------------------------------------------------------------------------
// LSP document synchronisation and diagnostics (#95). Uses the fake-lsp
// fixture; deterministic, no real language server or network.
// ---------------------------------------------------------------------------
await section("LSP documents and diagnostics (#95)", async () => {
  const documentsMod = await load("extensions/lsp/documents.ts");
  const toolsMod = await load("extensions/lsp/tools.ts");
  const clientMod = await load("extensions/lsp/client.ts");
  const registryMod = await load("extensions/lsp/registry.ts");
  const profilesMod = await load("extensions/lsp/server-profiles.ts");
  const typesMod = await load("extensions/lsp/types.ts");

  assert(
    typeof documentsMod?.DocumentSync === "function",
    "lsp documents exports DocumentSync",
  );
  assert(
    typeof documentsMod?.getDocumentSync === "function",
    "lsp documents exports getDocumentSync",
  );
  assert(
    typeof documentsMod?.resolveTarget === "function",
    "lsp documents exports resolveTarget",
  );
  assert(
    typeof toolsMod?.registerLspDiagnosticsTool === "function",
    "lsp tools exports registerLspDiagnosticsTool",
  );

  const fakeServer = FAKE_LSP_FIXTURE;
  const workspace = mkdtempSync(path.join(tmpdir(), "pi-lsp95-test-"));
  writeFileSync(path.join(workspace, "tsconfig.json"), "{}");
  const trackedClients = [];

  function makeClient(extra = {}) {
    const { args: extraArgs = [], ...rest } = extra;
    const client = new clientMod.LspClient({
      serverId: "fake",
      workspaceRoot: workspace,
      command: FAKE_LSP_COMMAND,
      args: [fakeServer, ...extraArgs],
      requestTimeoutMs: 1000,
      process: {
        maxRestarts: 1,
        backoffBaseMs: 40,
        backoffMaxMs: 80,
        shutdownGraceMs: 400,
      },
      ...rest,
    });
    trackedClients.push(client);
    return client;
  }

  async function check(name, fn) {
    try {
      await fn();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      assert(false, name + " threw: " + detail);
    }
  }

  async function settle(client) {
    try {
      await client.shutdown();
    } catch {
      /* best-effort cleanup */
    }
  }

  await check("didOpen precedes didChange, versions are monotone", async () => {
    const client = makeClient();
    await client.start();
    const sentNotifications = [];
    const originalNotify = client.notify.bind(client);
    client.notify = (method, params) => {
      sentNotifications.push({ method, params });
      originalNotify(method, params);
    };

    const filePath = path.join(workspace, "a.ts");
    writeFileSync(filePath, "const a = 1;\n");
    const sync = documentsMod.getDocumentSync(client, workspace);

    const first = sync.openOrSync(filePath, "typescript");
    eq(first.version, 1, "first sync is version 1");
    eq(
      sentNotifications[0]?.method,
      "textDocument/didOpen",
      "first sync sends didOpen",
    );

    writeFileSync(filePath, "const a = 2;\n");
    const second = sync.openOrSync(filePath, "typescript");
    eq(second.version, 2, "second sync increments version");
    eq(
      sentNotifications[1]?.method,
      "textDocument/didChange",
      "second sync sends didChange",
    );

    const third = sync.openOrSync(filePath, "typescript");
    eq(third.version, 2, "unchanged content keeps the same version");
    eq(third.changed, false, "unchanged content reports changed: false");
    eq(
      sentNotifications.length,
      2,
      "unchanged content sends no additional notification",
    );

    await settle(client);
  });

  await check(
    "a new diagnostics version replaces the previous one",
    async () => {
      const client = makeClient();
      await client.start();
      const filePath = path.join(workspace, "b.ts");
      writeFileSync(filePath, "const b = 1;\n");
      const sync = documentsMod.getDocumentSync(client, workspace);

      const v1 = sync.openOrSync(filePath, "typescript");
      const snap1 = await sync.waitForDiagnostics(filePath, v1.version, 2000);
      eq(
        snap1.diagnostics.length,
        1,
        "first version has exactly one diagnostic",
      );
      eq(
        snap1.diagnostics[0].message,
        "fake diagnostic for version 1",
        "diagnostic mentions its version",
      );

      writeFileSync(filePath, "const b = 2;\n");
      const v2 = sync.openOrSync(filePath, "typescript");
      const snap2 = await sync.waitForDiagnostics(filePath, v2.version, 2000);
      eq(
        snap2.diagnostics.length,
        1,
        "second version still has exactly one diagnostic (replaced, not appended)",
      );
      eq(
        snap2.diagnostics[0].message,
        "fake diagnostic for version 2",
        "diagnostic reflects the new version",
      );
      eq(
        sync.getDiagnostics(filePath).version,
        2,
        "cache holds only the latest diagnostics version",
      );

      await settle(client);
    },
  );

  await check(
    "waitForDiagnostics does not resolve with a stale version",
    async () => {
      const client = makeClient();
      await client.start();
      const filePath = path.join(workspace, "c.ts");
      writeFileSync(filePath, "const c = 1;\n");
      const sync = documentsMod.getDocumentSync(client, workspace);
      const v1 = sync.openOrSync(filePath, "typescript");
      await sync.waitForDiagnostics(filePath, v1.version, 2000); // cache now holds version 1

      let outcome;
      try {
        await sync.waitForDiagnostics(filePath, v1.version + 1, 300);
        outcome = "resolved";
      } catch {
        outcome = "rejected";
      }
      eq(
        outcome,
        "rejected",
        "waiting for a version newer than cached times out instead of resolving with stale data",
      );

      await settle(client);
    },
  );

  await check("close() clears all local document state", async () => {
    const client = makeClient();
    await client.start();
    const filePath = path.join(workspace, "d.ts");
    writeFileSync(filePath, "const d = 1;\n");
    const sync = documentsMod.getDocumentSync(client, workspace);
    sync.openOrSync(filePath, "typescript");
    await sync.waitForDiagnostics(filePath, 1, 2000);
    eq(sync.getVersion(filePath), 1, "version tracked before close");

    sync.close(filePath);
    eq(
      sync.getVersion(filePath),
      undefined,
      "close() clears the tracked version",
    );
    eq(
      sync.getDiagnostics(filePath),
      undefined,
      "close() clears cached diagnostics",
    );

    await settle(client);
  });

  await check("a restart invalidates tracked document state", async () => {
    const client = makeClient({
      args: ["--crash-after-init"],
      process: {
        maxRestarts: 1,
        backoffBaseMs: 30,
        backoffMaxMs: 60,
        shutdownGraceMs: 400,
      },
    });
    const restarted = new Promise((resolve) =>
      client.once("restart", () => resolve(true)),
    );
    await client.start();
    const filePath = path.join(workspace, "e.ts");
    writeFileSync(filePath, "const e = 1;\n");
    const sync = documentsMod.getDocumentSync(client, workspace);
    sync.openOrSync(filePath, "typescript");
    eq(sync.getVersion(filePath), 1, "version tracked before restart");

    await Promise.race([
      restarted,
      new Promise((r) => setTimeout(() => r(false), 2000)),
    ]);
    await new Promise((r) => setTimeout(r, 20)); // let the invalidate handler run
    eq(
      sync.getVersion(filePath),
      undefined,
      "restart invalidates tracked document state",
    );

    await settle(client);
  });

  await check("resolveTarget soft-fails on an unmapped extension", async () => {
    const filePath = path.join(workspace, "notes.xyz");
    writeFileSync(filePath, "whatever");
    const config = {
      enabled: true,
      mode: "auto",
      requestTimeoutMs: 2000,
      idleShutdownMs: 600000,
      workspaceSymbolLimit: 50,
      languages: profilesMod.PROFILES,
    };
    const result = documentsMod.resolveTarget(filePath, config);
    assert(
      result instanceof typesMod.LspError,
      "an unmapped extension yields a structured LspError, not a crash",
    );
  });

  await check(
    "lsp_diagnostics tool: end-to-end success releases the registry entry",
    async () => {
      const fakeTsProfile = {
        id: "typescript",
        label: "Fake TypeScript",
        enabled: true,
        command: FAKE_LSP_COMMAND,
        args: [fakeServer],
        rootMarkers: ["tsconfig.json"],
      };
      const config = {
        enabled: true,
        mode: "auto",
        requestTimeoutMs: 2000,
        idleShutdownMs: 100000,
        workspaceSymbolLimit: 50,
        languages: { ...profilesMod.PROFILES, typescript: fakeTsProfile },
      };
      const registry = new registryMod.ServerRegistry({ config });
      let releaseCalls = 0;
      const originalRelease = registry.release.bind(registry);
      registry.release = (root, id) => {
        releaseCalls += 1;
        originalRelease(root, id);
      };
      const deps = { getConfig: () => config, getRegistry: () => registry };

      const harness = createHarness();
      toolsMod.registerLspDiagnosticsTool(harness.api, deps);
      const tool = harness.tools.get("lsp_diagnostics");
      assert(Boolean(tool), "lsp_diagnostics tool is registered");

      const filePath = path.join(workspace, "tool-test.ts");
      writeFileSync(filePath, "const x = 1;\n");
      const context = harness.makeContext({ cwd: workspace });
      const result = await tool.execute(
        "call-1",
        { path: "tool-test.ts" },
        undefined,
        undefined,
        context,
      );
      assert(
        result.content[0].text.includes("fake diagnostic"),
        "lsp_diagnostics tool surfaces the fake server's diagnostic",
      );
      eq(
        releaseCalls,
        1,
        "release() runs exactly once after a successful tool call",
      );

      // An unmapped extension must not touch the registry at all (resolveTarget
      // fails before acquire() is ever called).
      const unknownPath = path.join(workspace, "notes2.xyz");
      writeFileSync(unknownPath, "whatever");
      const before = registry.size;
      const unknownResult = await tool.execute(
        "call-2",
        { path: "notes2.xyz" },
        undefined,
        undefined,
        context,
      );
      assert(
        unknownResult.content[0].text.toLowerCase().includes("kein lsp-profil"),
        "unknown extension yields a soft-fail message",
      );
      eq(
        registry.size,
        before,
        "unknown file type creates no new registry entry",
      );

      await registry.shutdownAll();
    },
  );

  await check(
    "lsp_diagnostics tool: a timeout still releases the registry entry",
    async () => {
      const noDiagProfile = {
        id: "typescript",
        label: "Fake TypeScript (no diagnostics)",
        enabled: true,
        command: FAKE_LSP_COMMAND,
        args: [fakeServer, "--no-diagnostics"],
        rootMarkers: ["tsconfig.json"],
      };
      const config = {
        enabled: true,
        mode: "auto",
        requestTimeoutMs: 300,
        idleShutdownMs: 100000,
        workspaceSymbolLimit: 50,
        languages: { ...profilesMod.PROFILES, typescript: noDiagProfile },
      };
      const registry = new registryMod.ServerRegistry({ config });
      let releaseCalls = 0;
      const originalRelease = registry.release.bind(registry);
      registry.release = (root, id) => {
        releaseCalls += 1;
        originalRelease(root, id);
      };
      const deps = { getConfig: () => config, getRegistry: () => registry };

      const harness = createHarness();
      toolsMod.registerLspDiagnosticsTool(harness.api, deps);
      const tool = harness.tools.get("lsp_diagnostics");
      const filePath = path.join(workspace, "timeout-test.ts");
      writeFileSync(filePath, "const y = 1;\n");
      const context = harness.makeContext({ cwd: workspace });

      const result = await tool.execute(
        "call-3",
        { path: "timeout-test.ts" },
        undefined,
        undefined,
        context,
      );
      assert(
        result.content[0].text.toLowerCase().includes("timeout"),
        "lsp_diagnostics surfaces a verständliche timeout message instead of hanging or crashing",
      );
      eq(
        releaseCalls,
        1,
        "release() runs exactly once even when waitForDiagnostics times out",
      );

      await registry.shutdownAll();
    },
  );

  // Defensive sweep: every client must be shut down with no process left.
  for (const client of trackedClients) {
    try {
      await client.shutdown();
    } catch {
      /* ignore */
    }
  }
  let liveCount = 0;
  for (const client of trackedClients) {
    if (client.processRunning) liveCount += 1;
  }
  eq(liveCount, 0, "no LSP client leaves a live process behind");

  try {
    rmSync(workspace, { recursive: true, force: true });
  } catch {
    /* ignore temp cleanup errors */
  }
});

await section(
  "LSP security and registry single-flight (P0.2, P1.1)",
  async () => {
    const documentsMod = await load("extensions/lsp/documents.ts");
    const toolsMod = await load("extensions/lsp/tools.ts");
    const typesMod = await load("extensions/lsp/types.ts");
    const registryMod = await load("extensions/lsp/registry.ts");
    const workspace = mkdtempSync(path.join(tmpdir(), "pi-lsp-sec-"));

    try {
      // ---- P0.2: resolveToolPath blocks absolute paths outside the project ----
      // runLspDiagnostics must soft-fail (return a message) instead of crashing
      // when given a system path like /etc/passwd.
      await (async () => {
        const deps = {
          getConfig: () => ({
            enabled: true,
            mode: "auto",
            requestTimeoutMs: 2000,
            idleShutdownMs: 100000,
            workspaceSymbolLimit: 50,
            languages: {},
          }),
          getRegistry: () => ({
            acquire: async () => ({ client: {} }),
            release: () => {},
          }),
        };
        const result = await toolsMod.runLspDiagnostics(
          deps,
          "/etc/passwd",
          workspace,
          false,
        );
        assert(
          /außerhalb des Projekts|ungültiger Pfad/i.test(
            result.content[0].text,
          ),
          "runLspDiagnostics soft-fails for /etc/passwd instead of throwing",
        );
      })();

      // ---- P0.2: DocumentSync rejects symlink escapes ----
      await (async () => {
        const elsewhere = mkdtempSync(
          path.join(tmpdir(), "pi-lsp-symlink-target-"),
        );
        const escapedFile = path.join(elsewhere, "secret.ts");
        writeFileSync(escapedFile, "export const secret = 1;\n");
        // Create a symlink inside workspace pointing outside.
        symlinkSync(elsewhere, path.join(workspace, "link-out"));
        const targetPath = path.join(workspace, "link-out", "secret.ts");

        const notifications = [];
        const fakeClient = {
          serverId: "fake",
          workspaceRoot: workspace,
          onNotification: () => {},
          on: () => {},
          off: () => {},
          notify: (method, params) => notifications.push({ method, params }),
        };
        const sync = new documentsMod.DocumentSync({
          client: fakeClient,
          workspaceRoot: workspace,
        });
        let threw = false;
        try {
          sync.openOrSync(targetPath, "typescript");
        } catch (error) {
          threw = true;
          assert(
            error instanceof typesMod.LspError,
            "symlink escape raises an LspError",
          );
          assert(
            /symlink.escape/i.test(error.cause ?? error.message),
            "symlink escape error carries a descriptive cause",
          );
        }
        assert(threw, "symlink escape is rejected with an error");
        eq(notifications.length, 0, "no didOpen is sent for a symlink escape");
        rmSync(elsewhere, { recursive: true, force: true });
      })();

      // ---- P0.2: DocumentSync rejects oversized files ----
      await (async () => {
        const bigFile = path.join(workspace, "huge.ts");
        // Write ~11 MB so the 10 MB limit triggers (Buffer avoids string limits).
        writeFileSync(bigFile, Buffer.alloc(11 * 1024 * 1024, 0x78));

        const fakeClient = {
          serverId: "fake",
          workspaceRoot: workspace,
          onNotification: () => {},
          on: () => {},
          off: () => {},
          notify: () => {},
        };
        const sync = new documentsMod.DocumentSync({
          client: fakeClient,
          workspaceRoot: workspace,
        });
        let threw = false;
        try {
          sync.openOrSync(bigFile, "typescript");
        } catch (error) {
          threw = true;
          assert(
            error instanceof typesMod.LspError,
            "oversized file raises an LspError",
          );
          assert(
            /10.MB.limit/i.test(error.cause ?? error.message),
            "oversized file error mentions the 10 MB limit",
          );
        }
        assert(threw, "an oversized file is rejected");
      })();

      // ---- P1.1: concurrent acquire shares the start and keeps the counter sane ----
      // Two acquires arriving while the server is still "starting" must both
      // resolve with the same client, and a single release() must NOT arm the
      // idle timer (i.e. activeRequests was incremented for the second caller).
      // We force the race deterministically by stubbing createClient so start()
      // only resolves when WE release the gate — guaranteeing both acquires see
      // the "starting" state and take the single-flight path.
      await (async () => {
        const config = {
          enabled: true,
          mode: "auto",
          requestTimeoutMs: 5000,
          idleShutdownMs: 5, // short: if armed erroneously, it fires within the wait
          workspaceSymbolLimit: 50,
          languages: {},
        };
        const registry = new registryMod.ServerRegistry({ config });

        const profile = {
          id: "singleflight",
          label: "Single Flight Test",
          enabled: true,
          command: "stub",
          args: [],
          rootMarkers: ["tsconfig.json"],
        };

        // Gate that blocks start() until we release it, so both acquires observe
        // the in-flight ("starting") promise.
        let startGate;
        const startPromise = new Promise((resolve) => {
          startGate = resolve;
        });
        let shutdownCalls = 0;
        const stubClient = {
          serverId: profile.id,
          workspaceRoot: workspace,
          get currentState() {
            return startedFlag ? "ready" : "starting";
          },
          pid: 4242,
          start: () => startPromise,
          shutdown: async () => {
            shutdownCalls += 1;
          },
          on: () => {},
          off: () => {},
          onNotification: () => {},
        };
        let startedFlag = false;
        // Patch the private factory so no real process is spawned.
        registry.createClient = () => stubClient;
        Object.defineProperty(stubClient, "currentState", {
          get: () => (startedFlag ? "ready" : "starting"),
        });

        const p1 = registry.acquire(workspace, profile);
        const p2 = registry.acquire(workspace, profile); // fires while starting

        // Release the gate so start() resolves and both promises settle.
        startedFlag = true;
        startGate();
        const [r1, r2] = await Promise.all([p1, p2]);

        assert(
          r1.client === stubClient && r2.client === stubClient,
          "concurrent acquires share the single in-flight client instance",
        );

        // Pre-fix bug: the second caller returned pendingAcquire without
        // incrementing activeRequests, so one release() dropped it to 0 and
        // armed the idle timer (and a manual idle would shut the server down).
        // With the fix, activeRequests == 2, so one release keeps it at 1.
        registry.release(workspace, profile.id);
        // Idle timer is 5ms. Pre-fix bug armed it immediately on activeRequests
        // hitting 0; with the fix activeRequests stays at 1, so no timer is armed
        // and shutdown() is never called. Waiting 40ms (>> 5ms) makes the
        // distinction deterministic.
        await new Promise((resolve) => setTimeout(resolve, 40));
        eq(
          shutdownCalls,
          0,
          "one release does not trigger shutdown while a second caller holds the client",
        );

        registry.release(workspace, profile.id);
      })();
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  },
);

// ---------------------------------------------------------------------------
// LSP navigation and symbol tools (#96). Uses the fake-lsp fixture;
// deterministic, no real language server or network.
// ---------------------------------------------------------------------------
await section("LSP navigation and symbol tools (#96)", async () => {
  const toolsMod = await load("extensions/lsp/tools.ts");
  const registryMod = await load("extensions/lsp/registry.ts");
  const profilesMod = await load("extensions/lsp/server-profiles.ts");

  assert(
    typeof toolsMod?.registerLspNavigationTools === "function",
    "lsp tools exports registerLspNavigationTools",
  );

  const fakeServer = FAKE_LSP_FIXTURE;
  const workspace = mkdtempSync(path.join(tmpdir(), "pi-lsp96-test-"));
  writeFileSync(path.join(workspace, "tsconfig.json"), "{}");
  const filePath = path.join(workspace, "target.ts");
  writeFileSync(filePath, "export const target = 1;\n");

  function fakeProfile(extra = {}) {
    const { args: extraArgs = [], ...rest } = extra;
    return {
      id: "typescript",
      label: "Fake TypeScript",
      enabled: true,
      command: FAKE_LSP_COMMAND,
      args: [fakeServer, ...extraArgs],
      rootMarkers: ["tsconfig.json"],
      ...rest,
    };
  }

  function makeRegistryDeps(profileExtra = {}, configExtra = {}) {
    const config = {
      enabled: true,
      mode: "auto",
      requestTimeoutMs: 2000,
      idleShutdownMs: 100000,
      workspaceSymbolLimit: 50,
      languages: {
        ...profilesMod.PROFILES,
        typescript: fakeProfile(profileExtra),
      },
      ...configExtra,
    };
    const registry = new registryMod.ServerRegistry({ config });
    return {
      config,
      registry,
      deps: { getConfig: () => config, getRegistry: () => registry },
    };
  }

  async function check(name, fn) {
    try {
      await fn();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      assert(false, name + " threw: " + detail);
    }
  }

  await check("lsp_definition: Location result", async () => {
    const { registry, deps } = makeRegistryDeps();
    const harness = createHarness();
    toolsMod.registerLspNavigationTools(harness.api, deps);
    const tool = harness.tools.get("lsp_definition");
    assert(Boolean(tool), "lsp_definition tool is registered");
    const context = harness.makeContext({ cwd: workspace });
    const result = await tool.execute(
      "call-1",
      { path: "target.ts", line: 0, character: 0 },
      undefined,
      undefined,
      context,
    );
    assert(
      result.content[0].text.includes("target.ts:5:3"),
      "definition points at the fake location",
    );
    await registry.shutdownAll();
  });

  await check("lsp_definition: LocationLink result", async () => {
    const { registry, deps } = makeRegistryDeps({
      args: ["--definition-links"],
    });
    const harness = createHarness();
    toolsMod.registerLspNavigationTools(harness.api, deps);
    const tool = harness.tools.get("lsp_definition");
    const context = harness.makeContext({ cwd: workspace });
    const result = await tool.execute(
      "call-2",
      { path: "target.ts", line: 0, character: 0, preferLinks: true },
      undefined,
      undefined,
      context,
    );
    assert(
      result.content[0].text.includes("target.ts:5:3"),
      "LocationLink result is normalised the same way as Location",
    );
    await registry.shutdownAll();
  });

  await check(
    "lsp_definition: capability gating without a server call",
    async () => {
      const { registry, deps } = makeRegistryDeps({
        args: ["--no-definition-provider"],
      });
      const harness = createHarness();
      toolsMod.registerLspNavigationTools(harness.api, deps);
      const tool = harness.tools.get("lsp_definition");
      const context = harness.makeContext({ cwd: workspace });
      const result = await tool.execute(
        "call-3",
        { path: "target.ts", line: 0, character: 0 },
        undefined,
        undefined,
        context,
      );
      assert(
        result.content[0].text.toLowerCase().includes("unterstützt"),
        "missing definitionProvider yields a soft-fail message instead of a request/crash",
      );
      await registry.shutdownAll();
    },
  );

  await check("lsp_references: limit truncates with a count hint", async () => {
    const { registry, deps } = makeRegistryDeps();
    const harness = createHarness();
    toolsMod.registerLspNavigationTools(harness.api, deps);
    const tool = harness.tools.get("lsp_references");
    const context = harness.makeContext({ cwd: workspace });
    const result = await tool.execute(
      "call-4",
      { path: "target.ts", line: 0, character: 0, limit: 2 },
      undefined,
      undefined,
      context,
    );
    assert(
      result.content[0].text.includes("2 von 3 gezeigt"),
      "references are truncated to the limit with a hint",
    );
    await registry.shutdownAll();
  });

  await check("lsp_hover: brief is shorter than full", async () => {
    const { registry, deps } = makeRegistryDeps();
    const harness = createHarness();
    toolsMod.registerLspNavigationTools(harness.api, deps);
    const tool = harness.tools.get("lsp_hover");
    const context = harness.makeContext({ cwd: workspace });
    const full = await tool.execute(
      "call-5",
      { path: "target.ts", line: 0, character: 0, verbosity: "full" },
      undefined,
      undefined,
      context,
    );
    const brief = await tool.execute(
      "call-6",
      { path: "target.ts", line: 0, character: 0, verbosity: "brief" },
      undefined,
      undefined,
      context,
    );
    assert(
      full.content[0].text.includes("Detailed hover contents"),
      "full hover includes the detail paragraph",
    );
    assert(
      brief.content[0].text.length <= full.content[0].text.length,
      "brief hover is not longer than full hover",
    );
    await registry.shutdownAll();
  });

  await check(
    "lsp_workspace_symbols: limit and TTL cache avoid a second request",
    async () => {
      const { registry, deps } = makeRegistryDeps();
      const harness = createHarness();
      toolsMod.registerLspNavigationTools(harness.api, deps);
      const tool = harness.tools.get("lsp_workspace_symbols");
      const context = harness.makeContext({ cwd: workspace });

      const first = await tool.execute(
        "call-7",
        { query: "target" },
        undefined,
        undefined,
        context,
      );
      assert(
        first.content[0].text.includes("target —"),
        "workspace symbol search returns the fake symbol",
      );
      assert(
        first.details?.cached === false,
        "first call is not served from cache",
      );

      const second = await tool.execute(
        "call-8",
        { query: "target" },
        undefined,
        undefined,
        context,
      );
      assert(
        second.details?.cached === true,
        "second identical call within TTL is served from cache",
      );
      await registry.shutdownAll();
    },
  );

  await check(
    "lsp_workspace_symbols: LRU cache stays bounded and clears expired entries",
    async () => {
      const { registry, deps } = makeRegistryDeps();
      const harness = createHarness();
      toolsMod.registerLspNavigationTools(harness.api, deps);
      const tool = harness.tools.get("lsp_workspace_symbols");
      const context = harness.makeContext({ cwd: workspace });
      const realNow = Date.now;
      let now = realNow();
      Date.now = () => now;
      try {
        for (let index = 0; index <= 100; index++) {
          await tool.execute(
            `lru-${index}`,
            { query: `symbol-${index}` },
            undefined,
            undefined,
            context,
          );
        }
        const newest = await tool.execute(
          "lru-newest",
          { query: "symbol-100" },
          undefined,
          undefined,
          context,
        );
        assert(
          newest.details?.cached === true,
          "the most recently inserted workspace-symbol query stays cached",
        );
        const oldest = await tool.execute(
          "lru-oldest",
          { query: "symbol-0" },
          undefined,
          undefined,
          context,
        );
        assert(
          oldest.details?.cached === false,
          "the 101st unique query evicts the oldest LRU entry",
        );
        now += 30_001;
        const expired = await tool.execute(
          "lru-expired",
          { query: "symbol-100" },
          undefined,
          undefined,
          context,
        );
        assert(
          expired.details?.cached === false,
          "expired workspace-symbol entries are purged before reuse",
        );
      } finally {
        Date.now = realNow;
        await registry.shutdownAll();
      }
    },
  );

  await check(
    "stale document version differs between two calls after a change",
    async () => {
      const { registry, deps } = makeRegistryDeps();
      const harness = createHarness();
      toolsMod.registerLspNavigationTools(harness.api, deps);
      const tool = harness.tools.get("lsp_hover");
      const context = harness.makeContext({ cwd: workspace });
      const staleFile = path.join(workspace, "stale.ts");
      writeFileSync(staleFile, "export const stale = 1;\n");

      const before = await tool.execute(
        "call-9",
        { path: "stale.ts", line: 0, character: 0 },
        undefined,
        undefined,
        context,
      );
      writeFileSync(
        staleFile,
        "export const stale = 2;\nexport const extra = 3;\n",
      );
      const after = await tool.execute(
        "call-10",
        { path: "stale.ts", line: 0, character: 0 },
        undefined,
        undefined,
        context,
      );
      assert(
        before.details?.version !== after.details?.version,
        "a file change between two calls is reflected in a different version tag",
      );
      await registry.shutdownAll();
    },
  );

  try {
    rmSync(workspace, { recursive: true, force: true });
  } catch {
    /* ignore temp cleanup errors */
  }
});

// ---------------------------------------------------------------------------
// LSP command, status and trust (#97). Uses the fake-lsp fixture;
// deterministic, no real language server or network.
// ---------------------------------------------------------------------------
await section("LSP command, status and trust (#97)", async () => {
  if (!lspExtensionMod) return;
  const registryMod = await load("extensions/lsp/registry.ts");
  const statusMod = await load("extensions/lsp/status.ts");

  assert(
    typeof lspExtensionMod.default === "function",
    "lsp index exports a default extension factory",
  );
  assert(
    typeof registryMod?.ServerRegistry.prototype.shutdownOne === "function",
    "registry exports shutdownOne",
  );
  assert(
    typeof statusMod?.computeLspStatus === "function",
    "lsp status exports computeLspStatus",
  );

  const fakeServer = FAKE_LSP_FIXTURE;

  // --- computeLspStatus: pure function, all four states ---
  const baseConfig = {
    enabled: true,
    mode: "auto",
    requestTimeoutMs: 2000,
    idleShutdownMs: 100000,
    workspaceSymbolLimit: 50,
    languages: {},
  };
  eq(
    statusMod.computeLspStatus({ ...baseConfig, enabled: false }, []),
    "aus",
    "disabled config is off",
  );
  eq(
    statusMod.computeLspStatus({ ...baseConfig, mode: "off" }, []),
    "aus",
    "mode off is off",
  );
  eq(
    statusMod.computeLspStatus(baseConfig, []),
    "leerlauf",
    "no entries is idle",
  );
  eq(
    statusMod.computeLspStatus(baseConfig, [
      { state: "ready" },
      { state: "starting" },
    ]),
    "1 aktiv",
    "counts only ready entries as active",
  );
  eq(
    statusMod.computeLspStatus(baseConfig, [
      { state: "ready" },
      { state: "degraded" },
    ]),
    "eingeschränkt",
    "any degraded entry reports degraded, even alongside a ready one",
  );

  // --- Trust gate: untrusted project never reads .pi/lsp.json ---
  {
    const cwd = mkdtempSync(path.join(tmpdir(), "pi-lsp97-trust-"));
    mkdirSync(path.join(cwd, ".pi"), { recursive: true });
    // Deliberately invalid JSON: if this were ever read and parsed, it would
    // either throw (caught, logged) or — if the trust gate is broken and it
    // gets applied — flip `enabled` to false below. Untrusted must ignore it
    // outright, not merely fail to parse it.
    writeFileSync(
      path.join(cwd, ".pi", "lsp.json"),
      JSON.stringify({ enabled: false }),
    );

    const harness = createHarness();
    lspExtensionMod.default(harness.api);
    const context = harness.makeContext({ cwd, trusted: false });
    await harness.runHooks("session_start", {}, context);
    harness.api.events.emit("aurora-ui/state/request", {
      type: "request",
      requestId: "lsp-state",
      sessionEpoch: "lsp-epoch",
      requester: "test",
    });
    // .pi/lsp.json sets enabled:false; if the trust gate were broken and it
    // got applied anyway, /lsp status would report "off" instead.
    await harness.commands.get("lsp")("status", context);
    const statusText = harness.notifications.at(-1)?.message ?? "";
    assert(
      statusText.includes("LSP: leerlauf") ||
        statusText.includes("LSP: 1 aktiv"),
      "untrusted project ignores .pi/lsp.json and keeps the default enabled config (got: " +
        statusText +
        ")",
    );
    await harness.runHooks("session_shutdown", {}, context);
    try {
      rmSync(cwd, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }

  // --- Trust gate: trusted project applies .pi/lsp.json ---
  {
    const cwd = mkdtempSync(path.join(tmpdir(), "pi-lsp97-trusted-"));
    mkdirSync(path.join(cwd, ".pi"), { recursive: true });
    writeFileSync(
      path.join(cwd, ".pi", "lsp.json"),
      JSON.stringify({ enabled: false }),
    );

    const harness = createHarness();
    lspExtensionMod.default(harness.api);
    const context = harness.makeContext({ cwd, trusted: true });
    await harness.runHooks("session_start", {}, context);
    await harness.commands.get("lsp")("status", context);
    const statusText = harness.notifications.at(-1)?.message ?? "";
    assert(
      statusText.includes("LSP: aus"),
      "trusted project applies .pi/lsp.json's enabled:false (got: " +
        statusText +
        ")",
    );
    await harness.runHooks("session_shutdown", {}, context);
    try {
      rmSync(cwd, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }

  // --- /lsp on|off toggles config.enabled and stops/starts the registry ---
  {
    const cwd = mkdtempSync(path.join(tmpdir(), "pi-lsp97-onoff-"));
    writeFileSync(path.join(cwd, "tsconfig.json"), "{}");
    writeFileSync(path.join(cwd, "a.ts"), "const a = 1;\n");

    const harness = createHarness();
    lspExtensionMod.default(harness.api);
    const context = harness.makeContext({ cwd, trusted: true });
    await harness.runHooks("session_start", {}, context);

    await harness.commands.get("lsp")("off", context);
    let statusText = harness.notifications.at(-1)?.message ?? "";
    assert(
      statusText.includes("deaktiviert"),
      "/lsp off confirms deactivation",
    );
    await harness.commands.get("lsp")("status", context);
    statusText = harness.notifications.at(-1)?.message ?? "";
    assert(statusText.includes("LSP: aus"), "/lsp off flips the status to off");

    await harness.commands.get("lsp")("on", context);
    statusText = harness.notifications.at(-1)?.message ?? "";
    assert(statusText.includes("aktiviert"), "/lsp on confirms activation");
    await harness.commands.get("lsp")("status", context);
    statusText = harness.notifications.at(-1)?.message ?? "";
    assert(
      statusText.includes("LSP: leerlauf") ||
        statusText.includes("LSP: 1 aktiv"),
      "/lsp on flips the status back to idle/active",
    );

    await harness.runHooks("session_shutdown", {}, context);
    try {
      rmSync(cwd, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }

  // --- /lsp restart <id> and /lsp restart (all) ---
  {
    const cwd = mkdtempSync(path.join(tmpdir(), "pi-lsp97-restart-"));
    writeFileSync(path.join(cwd, "tsconfig.json"), "{}");
    const filePath = path.join(cwd, "a.ts");
    writeFileSync(filePath, "const a = 1;\n");

    const fakeTsProfile = {
      id: "typescript",
      label: "Fake TypeScript",
      enabled: true,
      command: FAKE_LSP_COMMAND,
      args: [fakeServer],
      rootMarkers: ["tsconfig.json"],
    };
    const config = {
      enabled: true,
      mode: "auto",
      requestTimeoutMs: 2000,
      idleShutdownMs: 100000,
      workspaceSymbolLimit: 50,
      languages: { typescript: fakeTsProfile },
    };
    const registry = new registryMod.ServerRegistry({ config });
    await registry.acquire(cwd, fakeTsProfile);
    registry.release(cwd, fakeTsProfile.id);
    eq(registry.size, 1, "one server registered before restart");

    const stopped = await registry.shutdownOne(cwd, fakeTsProfile.id);
    assert(stopped === true, "shutdownOne reports it stopped a tracked entry");
    eq(registry.size, 0, "shutdownOne removes the entry");

    const missing = await registry.shutdownOne(cwd, "does-not-exist");
    eq(missing, false, "shutdownOne is a no-op for an untracked key");

    const again = await registry.acquire(cwd, fakeTsProfile);
    assert(
      typeof again.client.pid === "number",
      "the server respawns lazily on next acquire",
    );
    await registry.shutdownAll();
    try {
      rmSync(cwd, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }

  // --- /lsp servers and /lsp log ---
  {
    const cwd = mkdtempSync(path.join(tmpdir(), "pi-lsp97-servers-"));
    const harness = createHarness();
    lspExtensionMod.default(harness.api);
    const context = harness.makeContext({ cwd, trusted: true });
    await harness.runHooks("session_start", {}, context);

    await harness.commands.get("lsp")("servers", context);
    let text = harness.notifications.at(-1)?.message ?? "";
    assert(
      text.includes("keine aktiven Server"),
      "/lsp servers reports no active servers initially",
    );

    await harness.commands.get("lsp")("log", context);
    text = harness.notifications.at(-1)?.message ?? "";
    assert(text.includes("kein Log"), "/lsp log reports empty log initially");

    await harness.runHooks("session_shutdown", {}, context);
    try {
      rmSync(cwd, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }

  // --- resolveLspInteractiveCommand is the one resolver behind bare /lsp
  // and the Command Center guide, so a chosen action can no longer differ
  // depending on which entry point picked it ---
  {
    const restartHarness = createHarness({
      select: (labels) =>
        labels.find((label) => label.includes("Server neu starten")),
      input: () => "primary",
    });
    const restartContext = restartHarness.makeContext();
    restartContext.ui.custom = async () => {
      throw new Error("use deterministic select fallback");
    };
    eq(
      await lspControlCenter.resolveLspInteractiveCommand(restartContext),
      "restart primary",
      "restart threads the typed server id through the shared resolver",
    );

    const restartAllHarness = createHarness({
      select: (labels) =>
        labels.find((label) => label.includes("Server neu starten")),
      input: () => "  ",
    });
    const restartAllContext = restartAllHarness.makeContext();
    restartAllContext.ui.custom = async () => {
      throw new Error("use deterministic select fallback");
    };
    eq(
      await lspControlCenter.resolveLspInteractiveCommand(restartAllContext),
      "restart",
      "leaving the server id blank still restarts every server",
    );

    let statusInputCalls = 0;
    const statusHarness = createHarness({
      select: (labels) => labels.find((label) => label.includes("Status")),
      input: () => {
        statusInputCalls += 1;
        return undefined;
      },
    });
    const statusContext = statusHarness.makeContext();
    statusContext.ui.custom = async () => {
      throw new Error("use deterministic select fallback");
    };
    eq(
      await lspControlCenter.resolveLspInteractiveCommand(statusContext),
      "status",
      "non-restart choices resolve directly",
    );
    eq(statusInputCalls, 0, "non-restart choices never prompt for a server id");
  }

  // --- bare /lsp now reuses that resolver, so restart honors a typed id
  // instead of silently restarting every server (the pre-fix behavior) ---
  {
    const cwd = mkdtempSync(path.join(tmpdir(), "pi-lsp97-bare-menu-"));
    const harness = createHarness({
      select: (labels) =>
        labels.find((label) => label.includes("Server neu starten")),
      input: () => "ghost-server",
    });
    lspExtensionMod.default(harness.api);
    const context = harness.makeContext({ cwd, trusted: true });
    context.ui.custom = async () => {
      throw new Error("use deterministic select fallback");
    };
    await harness.runHooks("session_start", {}, context);

    await harness.commands.get("lsp")("", context);
    const text = harness.notifications.at(-1)?.message ?? "";
    assert(
      text.includes("kein laufender Server 'ghost-server'"),
      "bare /lsp restart targets exactly the typed server id (got: " +
        text +
        ")",
    );

    await harness.runHooks("session_shutdown", {}, context);
    try {
      rmSync(cwd, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }

  // --- Footer status only appears in TUI mode ---
  {
    for (const mode of ["json", "print", "rpc"]) {
      const nonTui = createHarness();
      lspExtensionMod.default(nonTui.api);
      const cwd = mkdtempSync(path.join(tmpdir(), "pi-lsp97-nontui-"));
      const contextForMode = nonTui.makeContext({
        cwd,
        mode,
        hasUI: false,
        trusted: true,
      });
      await nonTui.runHooks("session_start", {}, contextForMode);
      eq(
        nonTui.statusCalls.filter((c) => c.key === "lsp"),
        [],
        "lsp status is not published outside TUI mode (" + mode + ")",
      );
      await nonTui.runHooks("session_shutdown", {}, contextForMode);
      try {
        rmSync(cwd, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }

  // --- session_shutdown leaves no orphan processes ---
  {
    const cwd = mkdtempSync(path.join(tmpdir(), "pi-lsp97-shutdown-"));
    writeFileSync(path.join(cwd, "tsconfig.json"), "{}");
    const filePath = path.join(cwd, "a.ts");
    writeFileSync(filePath, "const a = 1;\n");

    const fakeTsProfile = {
      id: "typescript",
      label: "Fake TypeScript",
      enabled: true,
      command: FAKE_LSP_COMMAND,
      args: [fakeServer],
      rootMarkers: ["tsconfig.json"],
    };
    const config = {
      enabled: true,
      mode: "auto",
      requestTimeoutMs: 2000,
      idleShutdownMs: 100000,
      workspaceSymbolLimit: 50,
      languages: { typescript: fakeTsProfile },
    };
    const registry = new registryMod.ServerRegistry({ config });
    const acquired = await registry.acquire(cwd, fakeTsProfile);
    registry.release(cwd, fakeTsProfile.id);
    assert(acquired.client.processRunning, "server is running before shutdown");
    await registry.shutdownAll();
    assert(
      !acquired.client.processRunning,
      "no orphan process remains after shutdownAll",
    );
    try {
      rmSync(cwd, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

await section("diff viewer regressions", async () => {
  assert(
    typeof diffAlgorithm?.computeWordDiff === "function",
    "diff algorithm loads",
  );
  assert(
    typeof diffFallback?.computeFallbackDiff === "function",
    "diff fallback loads",
  );
  assert(
    typeof diffAlgorithm?.applyInlineHighlights === "function",
    "diff algorithm owns the shared inline-highlighting helper",
  );
  const diffFallbackSource = readFileSync(
    path.join(ROOT, "extensions", "diff-viewer", "git-diff.ts"),
    "utf8",
  );
  assert(
    !/pi\.exec|gitDiffForFile|gitDiffAll|isGitAvailable/.test(
      diffFallbackSource,
    ),
    "active fallback diff has no dormant Git subprocess path",
  );

  const long = "token ".repeat(600);
  eq(
    diffAlgorithm.computeWordDiff(long, long + "changed"),
    [],
    "large inline diffs skip quadratic word highlighting",
  );

  const before = Array.from({ length: 20 }, (_, index) => `line ${index}`).join(
    "\n",
  );
  const after = before
    .replace("line 2", "line two")
    .replace("line 17", "line seventeen");
  const separated = diffFallback.computeFallbackDiff(
    "sample.txt",
    before,
    after,
  );
  eq(
    separated.hunks.length,
    2,
    "fallback diff separates distant changes into hunks",
  );

  const cleared = diffFallback.computeFallbackDiff(
    "empty.txt",
    "keep\nremove",
    "",
  );
  eq(cleared.stats.linesRemoved, 2, "empty write records removed lines");

  const finalNewline = diffFallback.computeFallbackDiff(
    "newline.txt",
    "",
    "line\n",
  );
  eq(
    finalNewline.stats.linesAdded,
    1,
    "final newline does not add a phantom diff line",
  );

  if (diffViewer?.default) {
    const cwd = mkdtempSync(path.join(tmpdir(), "pi-diff-viewer-p1-"));
    try {
      const file = path.join(cwd, "sample.txt");
      writeFileSync(file, "before\n", "utf8");
      const harness = createHarness();
      diffViewer.default(harness.api);
      const context = harness.makeContext({ cwd });
      await harness.runHooks("session_start", {}, context);
      await harness.runHooks(
        "tool_call",
        {
          toolCallId: "same-content",
          toolName: "write",
          input: { path: "sample.txt", content: "after\n" },
        },
        context,
      );
      writeFileSync(file, "after\n", "utf8");
      await harness.runHooks(
        "tool_result",
        {
          toolCallId: "same-content",
          toolName: "write",
          input: { path: "sample.txt" },
          isError: false,
        },
        context,
      );
      assert(
        harness.execCalls.every((call) => call.command !== "cat"),
        "diff viewer reads snapshots through Node FS instead of spawning cat",
      );
      eq(
        harness.appended.at(-1)?.data?.stats,
        { path: "sample.txt", linesAdded: 1, linesRemoved: 1, hunks: 1 },
        "diff viewer persists the expected successful write diff",
      );

      await harness.runHooks(
        "tool_call",
        {
          toolCallId: "changed-content",
          toolName: "write",
          input: { path: "sample.txt", content: "predicted\n" },
        },
        context,
      );
      writeFileSync(file, "actual\nextra\n", "utf8");
      await harness.runHooks(
        "tool_result",
        {
          toolCallId: "changed-content",
          toolName: "write",
          input: { path: "sample.txt" },
          isError: false,
        },
        context,
      );
      eq(
        harness.appended.at(-1)?.data?.stats,
        { path: "sample.txt", linesAdded: 2, linesRemoved: 1, hunks: 1 },
        "diff viewer records the actual content when it differs from the preview",
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }

  const tracker = new diffTracker.ChangeTracker();
  tracker.recordChange(
    "b.txt",
    "write",
    { path: "b.txt", linesAdded: 1, linesRemoved: 0, hunks: 1 },
    [],
    10,
  );
  tracker.recordChange(
    "a.txt",
    "edit",
    { path: "a.txt", linesAdded: 1, linesRemoved: 0, hunks: 1 },
    [],
    20,
  );
  eq(
    tracker.changedFiles.map((change) => change.path),
    ["a.txt", "b.txt"],
    "tracker sorts by persisted timestamp",
  );
});

// A section missing from SECTION_SUITES would run unfiltered but vanish from
// every PI_TEST_SUITE run, so treat it as a failure rather than a silent gap.
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
