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
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const require = createRequire(import.meta.url);
const { createJiti } = require("../npm/node_modules/jiti");

function packageEntry(name) {
  const roots = [
    path.join(ROOT, "npm", "node_modules"),
    path.join(
      ROOT,
      "npm",
      "node_modules",
      "@earendil-works",
      "pi-coding-agent",
      "node_modules",
    ),
  ];
  for (const root of roots) {
    const directory = path.join(root, ...name.split("/"));
    const manifest = path.join(directory, "package.json");
    if (!existsSync(manifest)) continue;
    const pkg = JSON.parse(readFileSync(manifest, "utf8"));
    const exported =
      typeof pkg.exports === "string" ? pkg.exports : pkg.exports?.["."];
    return path.join(
      directory,
      (typeof exported === "string"
        ? exported
        : exported?.import ?? exported?.default) ??
        pkg.module ??
        pkg.main ??
        "index.js",
    );
  }
  throw new Error(`Package fehlt: ${name}`);
}

const jiti = createJiti(path.join(ROOT, "npm", "package.json"), {
  alias: {
    "@earendil-works/pi-coding-agent": packageEntry(
      "@earendil-works/pi-coding-agent",
    ),
    "@earendil-works/pi-agent-core": packageEntry(
      "@earendil-works/pi-agent-core",
    ),
    "@earendil-works/pi-ai": packageEntry("@earendil-works/pi-ai"),
    "@earendil-works/pi-tui": packageEntry("@earendil-works/pi-tui"),
    typebox: packageEntry("typebox"),
  },
});

const load = (relative) => jiti.import(path.join(ROOT, relative));
const snapshotMod = await load("extensions/plan-mode/plan-snapshot.ts");
const store = await load("extensions/plan-mode/store.ts");
const execution = await load("extensions/plan-mode/execution.ts");
const planning = await load("extensions/plan-mode/planning.ts");
const completion = await load("extensions/plan-mode/completion.ts");
const policy = await load("extensions/shared/permission-policy.ts");
const status = await load("extensions/shared/workflow-status.ts");
const reviewerRpc = await load("extensions/plan-mode/reviewer-rpc.ts");
const planExtension = await load("extensions/plan-mode/index.ts");
const verifyProfiles = await load("extensions/setup-core/verify-profiles.ts");
const setupConfig = await load("extensions/setup-core/config.ts");
const permissionsExtension = await load("extensions/mode-permissions.ts");

let passed = 0;
let failed = 0;
function assert(value, message) {
  if (value) passed += 1;
  else {
    failed += 1;
    console.error(`  FAIL: ${message}`);
  }
}
function equal(actual, expected, message) {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}
async function test(name, run) {
  try {
    await run();
  } catch (error) {
    failed += 1;
    console.error(`  FAIL: ${name} threw\n${error?.stack ?? error}`);
  }
}

function quickPlan(step = "Implementiere den Adapter") {
  return `# Umbauplan

## Ziel
Den Workflow vereinfachen.

## Nicht-Ziele
- Keine Dependency-Änderung

## Gewählte Lösung
PlanSnapshot und Sidecar trennen.

## Annahmen
- Git ist verfügbar

## Umsetzungsschritte
1. ${step}
2. Ergänze die Tests

## Betroffene Bereiche
- extensions/plan-mode

## Technischer Scope
- extensions/plan-mode/**
- tests/**

## Änderungsregeln
- Nutzeränderungen erhalten

## Risiken
- Migration alter States

## Verifikation
- npm --prefix npm run typecheck

## Abschlusskriterien
- v3-State ist atomar
`;
}

await test("PlanSnapshot metadata and stable ids", () => {
  const first = snapshotMod.finalizePlanDocument(
    quickPlan(),
    "simple_plan",
  );
  equal(first.snapshot.planRevision, 1, "first revision is one");
  equal(first.snapshot.steps.length, 2, "numbered steps are parsed");
  assert(
    first.content.includes("PI-PLAN-METADATA:") &&
      first.content.match(/PI-STEP-ID:/g)?.length === 2,
    "metadata and invisible step ids are stamped",
  );
  const unchanged = snapshotMod.finalizePlanDocument(
    first.content,
    "simple_plan",
    first.content,
  );
  equal(unchanged.snapshot.planRevision, 1, "unchanged plan keeps revision");
  equal(
    unchanged.snapshot.steps.map((step) => step.id),
    first.snapshot.steps.map((step) => step.id),
    "unchanged plan keeps step ids",
  );
  const changed = snapshotMod.finalizePlanDocument(
    quickPlan("Implementiere den neuen Adapter"),
    "simple_plan",
    first.content,
  );
  equal(changed.snapshot.planRevision, 2, "semantic edit increments revision");
  equal(
    changed.snapshot.steps[1].id,
    first.snapshot.steps[1].id,
    "unchanged step identity survives a revision",
  );
});

await test("architecture plans require two to four options", () => {
  assert(
    planning.planningPrompt("detailed_plan").includes("ask_user"),
    "architecture planning requires an explicit user decision when still open",
  );
  let rejected = false;
  try {
    snapshotMod.finalizePlanDocument(quickPlan(), "detailed_plan");
  } catch {
    rejected = true;
  }
  assert(rejected, "architecture plan without options is rejected");
  const detailed = quickPlan().replace(
    "## Umsetzungsschritte",
    "## Bewertete Optionen\n- Adapter: geringe Kopplung\n- Monolith: geringere Dateizahl\n\n## Umsetzungsschritte",
  );
  assert(
    snapshotMod.finalizePlanDocument(detailed, "detailed_plan").snapshot,
    "architecture plan with two options is accepted",
  );
  let extraSectionRejected = false;
  try {
    snapshotMod.finalizePlanDocument(
      quickPlan().replace(
        "## Risiken",
        "## Nicht vereinbarter Zusatz\n- darf nicht still akzeptiert werden\n\n## Risiken",
      ),
      "simple_plan",
    );
  } catch {
    extraSectionRejected = true;
  }
  assert(
    extraSectionRejected,
    "plan format rejects additional or out-of-order H2 sections",
  );
});

await test("changed plans and corrupt sidecars recover conservatively", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "pi-v3-recovery-"));
  try {
    const first = snapshotMod.finalizePlanDocument(
      quickPlan(),
      "simple_plan",
    );
    const initial = store.writePlanAndStateCAS(
      cwd,
      first.snapshot,
      "missing",
    );
    store.writeWorkflowStateCAS(
      cwd,
      {
        ...initial.state,
        status: "reviewing",
        reviewedPlanHash: first.snapshot.planHash,
      },
      initial.stateToken,
    );
    const changed = snapshotMod.finalizePlanDocument(
      quickPlan("Implementiere den geänderten Adapter"),
      "simple_plan",
      first.content,
    );
    writeFileSync(
      path.join(cwd, store.PLAN_RELATIVE_PATH),
      changed.content,
    );
    const invalidated = store.loadWorkflowStateV3(cwd);
    equal(
      invalidated.state.status,
      "planning",
      "plan change resets the workflow to planning",
    );
    equal(
      invalidated.state.reviewedPlanHash,
      undefined,
      "plan change invalidates the reviewed hash",
    );
    writeFileSync(
      path.join(cwd, store.WORKFLOW_STATE_RELATIVE_PATH),
      "{broken",
    );
    const corrupt = store.loadWorkflowStateV3(cwd);
    assert(
      corrupt.recovered &&
        corrupt.state.status === "planning" &&
        corrupt.state.completion === undefined,
      "corrupt sidecar is recovered as planning and never as success",
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

await test("sidecar CAS, immutable plan and deterministic archive", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "pi-v3-store-"));
  try {
    const finalized = snapshotMod.finalizePlanDocument(
      quickPlan(),
      "simple_plan",
    );
    const initial = store.writePlanAndStateCAS(
      cwd,
      finalized.snapshot,
      "missing",
    );
    equal(initial.state.status, "planning", "new state starts in planning");
    let state = execution.startOrResumeExecution(initial.state);
    const paused = execution.pauseExecution({
      ...state,
      activeStepId: finalized.snapshot.steps[0].id,
      steps: state.steps.map((step, index) =>
        index === 0 ? { ...step, status: "in_progress" } : step,
      ),
    });
    equal(paused.status, "paused", "explicit pause persists a resumable state");
    assert(
      paused.activeStepId === undefined &&
        paused.steps.every((step) => step.status !== "in_progress"),
      "pause clears transient step ownership without a heartbeat",
    );
    state = execution.startOrResumeExecution(paused);
    let saved = store.writeWorkflowStateCAS(
      cwd,
      state,
      initial.stateToken,
    );
    equal(saved.state.status, "working", "explicit work starts execution");
    for (const step of finalized.snapshot.steps) {
      state = execution.updateExecutionStep(saved.state, {
        stepId: step.id,
        status: "completed",
        evidence: "unit test passed",
      }).state;
      saved = store.writeWorkflowStateCAS(cwd, state, saved.stateToken);
    }
    equal(saved.state.status, "reviewing", "last completed step enters review");
    assert(
      !readFileSync(
        path.join(cwd, store.PLAN_RELATIVE_PATH),
        "utf8",
      ).includes("[x]"),
      "progress never mutates plan markdown",
    );
    let conflicted = false;
    try {
      store.writeWorkflowStateCAS(cwd, saved.state, initial.stateToken);
    } catch {
      conflicted = true;
    }
    assert(conflicted, "stale state token is rejected");
    const report = {
      version: 1,
      completionId: "completion-test",
      planId: finalized.snapshot.planId,
      planRevision: finalized.snapshot.planRevision,
      planHash: finalized.snapshot.planHash,
      diffHash: "a".repeat(64),
      outcome: "passed",
      reviewerVerdict: "PASS",
      checks: [
        "plan-steps",
        "git-diff-check",
        "hard-boundaries",
        "technical-scope",
        "declared-verification",
        "independent-reviewer",
        "diff-stability",
      ].map((name) => ({
        name,
        classification: "required",
        status: "pass",
        summary: "passed",
      })),
      scopeFindings: [],
      residualRisks: [],
      reviewerSummary: "Keine Befunde.",
      completedAt: "2026-07-27T12:00:00.000Z",
    };
    let forgedPassRejected = false;
    try {
      store.commitWorkflowDone(
        cwd,
        saved.state,
        saved.stateToken,
        { ...report, checks: [] },
      );
    } catch {
      forgedPassRejected = true;
    }
    assert(
      forgedPassRejected,
      "store rejects a forged PASS report without completion evidence",
    );
    const done = store.commitWorkflowDone(
      cwd,
      saved.state,
      saved.stateToken,
      report,
    );
    equal(done.state.status, "done", "only completion commit creates done");
    const archive = store.archiveCompletedWorkflow(
      cwd,
      done.state,
      done.stateToken,
      report,
    );
    assert(existsSync(archive), "completion archive exists");
    assert(
      !existsSync(path.join(cwd, store.PLAN_RELATIVE_PATH)) &&
        !existsSync(path.join(cwd, store.WORKFLOW_STATE_RELATIVE_PATH)),
      "active plan and sidecar are removed after archive",
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

await test("legacy migration is explicit, backed up and lease-aware", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "pi-v3-migrate-"));
  try {
    mkdirSync(path.join(cwd, ".agent", "plans"), { recursive: true });
    writeFileSync(path.join(cwd, store.PLAN_RELATIVE_PATH), quickPlan());
    writeFileSync(
      path.join(cwd, store.WORKFLOW_STATE_RELATIVE_PATH),
      JSON.stringify({
        version: 2,
        planId: "legacy-id",
        phase: "paused",
      }),
    );
    assert(
      store.loadWorkflowStateV3(cwd).migrationRequired,
      "legacy state is never migrated implicitly",
    );
    let unconfirmed = false;
    try {
      store.migrateLegacyWorkflowToV3(cwd, {
        confirmedLegacySessionsClosed: false,
      });
    } catch {
      unconfirmed = true;
    }
    assert(unconfirmed, "migration requires session-closure confirmation");
    const migrated = store.migrateLegacyWorkflowToV3(cwd, {
      confirmedLegacySessionsClosed: true,
      now: new Date("2026-07-27T10:00:00.000Z"),
    });
    equal(migrated.state.version, 3, "migration writes v3 state");
    assert(
      readdirSync(
        path.join(cwd, store.MIGRATION_BACKUP_RELATIVE_DIR),
      ).length === 1,
      "migration creates one timestamped backup",
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

await test("live legacy lease and occupied v3 lock never time out implicitly", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "pi-v3-lock-"));
  try {
    mkdirSync(path.join(cwd, ".agent", "plans"), { recursive: true });
    writeFileSync(path.join(cwd, store.PLAN_RELATIVE_PATH), quickPlan());
    writeFileSync(
      path.join(cwd, store.WORKFLOW_STATE_RELATIVE_PATH),
      JSON.stringify({
        version: 2,
        execution: {
          ownerId: "other-session",
          leaseExpiresAt: "2099-01-01T00:00:00.000Z",
        },
      }),
    );
    let liveLeaseBlocked = false;
    try {
      store.migrateLegacyWorkflowToV3(cwd, {
        confirmedLegacySessionsClosed: true,
        now: new Date("2026-07-27T10:00:00.000Z"),
      });
    } catch {
      liveLeaseBlocked = true;
    }
    assert(liveLeaseBlocked, "live v2 lease blocks migration");
    rmSync(path.join(cwd, store.WORKFLOW_STATE_RELATIVE_PATH));
    const lock = store.acquireWorkflowLock(cwd);
    let secondBlocked = false;
    try {
      store.acquireWorkflowLock(cwd);
    } catch {
      secondBlocked = true;
    }
    assert(secondBlocked, "occupied v3 lock is never stolen by elapsed time");
    lock.release();
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

await test("direct task schema enforces safe scope", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "pi-v3-direct-"));
  try {
    const task = store.saveDirectTask(cwd, {
      goal: "Fix",
      technicalScope: ["src/**"],
      verification: ["unit"],
      acceptanceCriteria: ["test passes"],
    });
    equal(store.loadDirectTask(cwd).taskId, task.taskId, "direct task roundtrips");
    let unsafe = false;
    try {
      store.saveDirectTask(cwd, {
        goal: "Escape",
        technicalScope: ["../outside"],
        verification: ["unit"],
        acceptanceCriteria: ["done"],
      });
    } catch {
      unsafe = true;
    }
    assert(unsafe, "unsafe direct-task scope is rejected");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

await test("permission model and legacy mapping", () => {
  equal(status.normalizePermissionLevel("read-only"), "readonly", "read-only migrates");
  equal(status.normalizePermissionLevel("read-bash"), "readonly", "read-bash migrates");
  equal(status.normalizePermissionLevel("read-write"), "project-write", "read-write migrates");
  equal(status.normalizePermissionLevel("full-access"), "confirm-all", "full-access migrates");
  equal(status.normalizePermissionLevel("yolo"), "project-write", "persisted yolo migrates safely");
  equal(
    setupConfig.defaultSetupConfig().permissions.workflowDefaults,
    {
      work: "project-write",
      simple_plan: "readonly",
      detailed_plan: "readonly",
    },
    "workflow defaults use project-write for work and readonly for planning",
  );
  equal(policy.decideBash("readonly", "ls -la", ROOT).action, "allow", "readonly permits inspection");
  equal(policy.decideBash("readonly", "touch x", ROOT).action, "block", "readonly blocks mutation");
  equal(policy.decideBash("project-write", "touch x", ROOT).action, "allow", "project-write permits routine project mutation");
  equal(policy.decideBash("confirm-all", "touch x", ROOT).action, "ask", "confirm-all asks for mutation");
  equal(policy.decideBash("yolo", "touch x", ROOT).action, "allow", "yolo bypasses routine confirmation");
  equal(policy.decideBash("yolo", "rm -rf /", ROOT).action, "block", "yolo retains root guard");
  equal(policy.decideBash("yolo", "sudo true", ROOT).action, "block", "yolo retains elevated-rights guard");
  equal(policy.decideBash("yolo", "touch /tmp/pi-outside", ROOT).action, "block", "yolo retains external-write guard");
  equal(
    policy.decideBash(
      "yolo",
      "python -c 'open(\"/etc/pi-agent-test\", \"w\")'",
      ROOT,
    ).action,
    "block",
    "yolo blocks opaque interpreters that could bypass system and secret guards",
  );
  equal(
    policy.decideFileAccess("confirm-all", "write", "src/a.ts", ROOT).action,
    "ask",
    "confirm-all asks for file mutation",
  );
  equal(
    policy.decideFileAccess("yolo", "read", ".env", ROOT).action,
    "block",
    "yolo retains secret guard",
  );
  const project = mkdtempSync(path.join(tmpdir(), "pi-v3-yolo-project-"));
  const outside = mkdtempSync(path.join(tmpdir(), "pi-v3-yolo-outside-"));
  try {
    symlinkSync(outside, path.join(project, "escape"), "dir");
    equal(
      policy.decideBash("yolo", "touch escape/new-file", project).action,
      "block",
      "yolo blocks writes through a project symlink even before the target exists",
    );
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

await test("permission extension exposes transitions, menus and hard guards", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "pi-v3-permissions-"));
  const commands = new Map();
  const shortcuts = new Map();
  const hooks = new Map();
  const events = new Map();
  const appended = [];
  const statuses = [];
  const notifications = [];
  const selections = [];
  const sessionEntries = [
    {
      type: "custom",
      customType: "mode-permissions",
      data: { permissionLevel: "yolo" },
    },
  ];
  let workflowState = "idle";
  let workflowMode = "simple_plan";
  let thinking = "high";
  const add = (map, name, handler) => {
    const list = map.get(name) ?? [];
    list.push(handler);
    map.set(name, list);
    return () => {
      const index = list.indexOf(handler);
      if (index >= 0) list.splice(index, 1);
    };
  };
  const api = {
    events: {
      on(name, handler) { return add(events, name, handler); },
      emit(name, value) {
        for (const handler of events.get(name) ?? []) handler(value);
      },
    },
    on(name, handler) { add(hooks, name, handler); },
    registerCommand(name, options) { commands.set(name, options.handler); },
    registerShortcut(name, options) { shortcuts.set(name, options.handler); },
    appendEntry(type, data) { appended.push({ type, data }); },
    getThinkingLevel() { return thinking; },
    setThinkingLevel(value) { thinking = value; },
  };
  const context = {
    cwd,
    mode: "tui",
    hasUI: true,
    model: {
      thinkingLevelMap: {
        minimal: 1,
        low: 1,
        medium: 1,
        high: 1,
        xhigh: 1,
      },
    },
    isProjectTrusted: () => true,
    sessionManager: {
      getSessionId: () => "permission-session",
      getEntries: () => sessionEntries,
    },
    ui: {
      setStatus(key, value) { statuses.push({ key, value }); },
      notify(message, level) { notifications.push({ message, level }); },
      async confirm() { return true; },
      async select() { return selections.shift(); },
    },
  };
  const runHook = async (name, event = {}) => {
    const results = [];
    for (const handler of hooks.get(name) ?? []) {
      results.push(await handler(event, context));
    }
    return results;
  };
  try {
    permissionsExtension.default(api);
    api.events.on("workflow-capabilities:request", (request) => {
      request.respond({ state: workflowState, mode: workflowMode });
    });
    api.events.on("control-center:workflow-thinking-default", (request) => {
      request.respond({ mode: "work", defaultLevel: "medium" });
    });
    await runHook("session_start");
    api.events.emit("aurora-ui/state/request", {
      type: "request",
      requestId: "permission-state",
      sessionEpoch: "aurora-epoch",
      requester: "test",
    });
    assert(
      statuses.some((entry) => entry.value?.includes("PROJECT WRITE")),
      "persisted legacy yolo migrates to project-write without reactivating yolo",
    );
    const managedStateWrite = await runHook("tool_call", {
      toolName: "write",
      input: { path: ".agent/plans/current-plan.state.json" },
    });
    assert(
      managedStateWrite.some((entry) => entry?.block),
      "managed workflow artifacts are never writable through generic tools",
    );
    const managedUnknownTool = await runHook("tool_call", {
      toolName: "upload",
      input: { filePath: ".agent/direct-task.json" },
    });
    assert(
      managedUnknownTool.some((entry) => entry?.block),
      "unknown path-capable tools cannot bypass managed workflow artifacts",
    );
    await commands.get("permission")("read-bash", context);
    assert(
      statuses.at(-1).value.includes("READONLY"),
      "legacy command value migrates visibly to readonly",
    );
    const blockedWrite = await runHook("tool_call", {
      toolName: "write",
      input: { path: "src/a.ts" },
    });
    assert(
      blockedWrite.some((entry) => entry?.block),
      "readonly tool policy blocks project writes",
    );
    const blockedIdlePlanWrite = await runHook("tool_call", {
      toolName: "write",
      input: { path: ".agent/plans/current-plan.md" },
    });
    assert(
      blockedIdlePlanWrite.some((entry) => entry?.block),
      "readonly plan exception is inactive outside planning",
    );
    const blockedVerify = await runHook("tool_call", {
      toolName: "verify",
      input: { check: "test" },
    });
    assert(
      blockedVerify.some((entry) => entry?.block),
      "readonly blocks potentially mutating verification tools",
    );
    workflowState = "planning";
    const reviewerAllowed = await runHook("tool_call", {
      toolName: "subagent",
      input: { agent: "reviewer", task: "Review" },
    });
    assert(
      reviewerAllowed.every((entry) => entry === undefined),
      "planning capability permits the known read-only reviewer",
    );
    const planningPlanWrite = await runHook("tool_call", {
      toolName: "write",
      input: { path: ".agent/plans/current-plan.md" },
    });
    assert(
      planningPlanWrite.every((entry) => entry === undefined),
      "planning grants only the controlled current-plan write exception",
    );
    workflowState = "idle";
    await commands.get("permission")("confirm-all", context);
    const confirmedWrite = await runHook("tool_call", {
      toolName: "write",
      input: { path: "src/a.ts" },
    });
    assert(
      confirmedWrite.every((entry) => entry === undefined),
      "confirm-all permits a user-confirmed mutation",
    );
    workflowState = "working";
    const protectedPlanBash = await runHook("tool_call", {
      toolName: "bash",
      input: {
        command:
          "printf changed > .agent/plans/current-plan.md",
      },
    });
    assert(
      protectedPlanBash.some((entry) => entry?.block),
      "working blocks shell mutation of workflow artifacts",
    );
    const protectedDirectBash = await runHook("user_bash", {
      command: "rm .agent/plans/current-plan.state.json",
      cwd,
    });
    assert(
      protectedDirectBash.some((entry) => entry?.result?.exitCode === 126),
      "working also blocks direct shell mutation of workflow artifacts",
    );
    workflowState = "idle";
    await commands.get("yolo")("", context);
    const hardYoloBlock = await runHook("tool_call", {
      toolName: "bash",
      input: { command: "sudo true" },
    });
    assert(
      hardYoloBlock.some((entry) => entry?.block),
      "temporary yolo keeps the elevated-rights guard",
    );
    assert(
      appended
        .filter((entry) => entry.type === "mode-permissions")
        .every((entry) => entry.data.permissionLevel !== "yolo"),
      "yolo is never persisted as effective permission",
    );
    await shortcuts.get("super+y")(context);
    await commands.get("full-access")("", context);
    await commands.get("full-access")("", context);
    assert(
      statuses.at(-1).value.includes("CONFIRM ALL"),
      "legacy full-access command selects confirm-all",
    );
    selections.push("Nur Lesen");
    for (const handler of events.get("control-center:open-permissions") ?? []) {
      await handler({ ctx: context });
    }
    selections.push(undefined);
    await shortcuts.get("super+d")(context);
    let snapshot;
    api.events.emit("control-center:snapshot", {
      respond(value) { snapshot = value; },
    });
    assert(Boolean(snapshot?.permissionLevel), "control center receives permission snapshot");
    api.events.emit("workflow-capabilities:activated", {
      cwd,
      sessionId: "permission-session",
      mode: "simple_plan",
    });
    workflowMode = "simple_plan";
    assert(
      statuses.at(-1).value.includes("READONLY"),
      "workflow activation applies readonly planning default",
    );
    const shell = await runHook("user_bash", {
      command: "touch x",
      cwd,
    });
    assert(
      shell.some((entry) => entry?.result?.exitCode === 126),
      "readonly direct shell mutation is blocked",
    );
    await runHook("session_shutdown");
    assert(
      notifications.length > 0 && appended.some((entry) => entry.type === "permission-transition"),
      "permission transitions stay visible and redacted in audit entries",
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

await test("verification profiles expose three strict classifications", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "pi-v3-profiles-"));
  try {
    mkdirSync(path.join(cwd, ".pi"), { recursive: true });
    writeFileSync(
      path.join(cwd, ".pi", "verify.json"),
      JSON.stringify({
        profiles: {
          required: {
            program: "true",
            args: [],
            classification: "required",
          },
          recommended: {
            program: "true",
            args: [],
            classification: "recommended",
          },
          advisory: {
            program: "true",
            args: [],
            classification: "advisory",
          },
          conflict: {
            program: "true",
            args: [],
            required: false,
            classification: "required",
          },
        },
      }),
    );
    const loaded = verifyProfiles.loadVerifyProfiles(cwd, true);
    equal(
      Object.fromEntries(
        Object.entries(loaded.profiles).map(([name, profile]) => [
          name,
          profile.classification,
        ]),
      ),
      {
        required: "required",
        recommended: "recommended",
        advisory: "advisory",
      },
      "classification is preserved and contradictory legacy projection is dropped",
    );
    assert(
      loaded.diagnostics.some((entry) =>
        entry.message.includes("widersprechen"),
      ),
      "classification conflict is diagnosed",
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

await test("completion marker is exact and pipeline rechecks stable diff", async () => {
  equal(
    completion.parseCompletionReviewerResult(
      "Keine Befunde.\n[COMPLETION-REVIEW:PASS]",
    ).verdict,
    "PASS",
    "final exact marker passes",
  );
  equal(
    completion.parseCompletionReviewerResult(
      "[COMPLETION-REVIEW:PASS]\nNachtrag",
    ).verdict,
    "UNVERIFIABLE",
    "marker must be the final nonempty line",
  );
  const finalized = snapshotMod.finalizePlanDocument(
    quickPlan(),
    "simple_plan",
  );
  const state = {
    ...store.createWorkflowState(finalized.snapshot),
    status: "reviewing",
    steps: finalized.snapshot.steps.map((step) => ({
      id: step.id,
      status: "completed",
      evidence: "passed",
    })),
  };
  const projectRoot = mkdtempSync(path.join(tmpdir(), "pi-v3-completion-"));
  try {
    mkdirSync(path.join(projectRoot, ".pi"), { recursive: true });
    writeFileSync(
      path.join(projectRoot, ".pi", "verify.json"),
      JSON.stringify({
        profiles: {
          typecheck: {
            program: "npm",
            args: ["run", "typecheck"],
            classification: "required",
          },
        },
      }),
    );
    const exec = async (_program, args) => {
      const joined = args.join(" ");
      if (joined.startsWith("status "))
        return { code: 0, stdout: " M extensions/plan-mode/a.ts\n", stderr: "", killed: false };
      if (joined === "diff --stat HEAD")
        return { code: 0, stdout: " 1 file changed\n", stderr: "", killed: false };
      if (joined === "diff --binary HEAD")
        return { code: 0, stdout: "diff --git a/a b/a\n+ok\n", stderr: "", killed: false };
      return { code: 0, stdout: "", stderr: "", killed: false };
    };
    const result = await completion.runCompletionPipeline({
      projectRoot,
      trusted: true,
      exec,
      plan: finalized.snapshot,
      state,
      runLsp: async (files) =>
        files.map((file) => ({ path: file, status: "pass", summary: "clean" })),
      runReviewer: async () => ({ verdict: "PASS", summary: "Keine Befunde." }),
    });
    equal(result.status, "pass", "required completion checks pass");
    assert(Boolean(result.report), "passing completion creates report");
    assert(
      result.checks.some(
        (check) => check.name === "diff-stability" && check.status === "pass",
      ),
      "pipeline rechecks diff stability after reviewer",
    );
    const uncovered = await completion.runCompletionPipeline({
      projectRoot,
      trusted: true,
      exec,
      plan: {
        ...finalized.snapshot,
        verification: ["missing-profile"],
      },
      state,
      runLsp: async () => [],
      runReviewer: async () => ({ verdict: "PASS", summary: "Keine Befunde." }),
    });
    equal(
      uncovered.status,
      "blocked",
      "declared verification without an executable profile blocks completion",
    );
    const outOfScope = await completion.runCompletionPipeline({
      projectRoot,
      trusted: true,
      exec,
      plan: {
        ...finalized.snapshot,
        technicalScope: ["src/**"],
      },
      state,
      runLsp: async () => [],
      runReviewer: async () => ({ verdict: "PASS", summary: "Keine Befunde." }),
    });
    equal(
      outOfScope.status,
      "fail",
      "out-of-scope changes block completion",
    );
    const renameExec = async (program, args) => {
      if (program === "git" && args.join(" ").startsWith("status ")) {
        return {
          code: 0,
          stdout:
            "R  outside/old.ts -> extensions/plan-mode/a.ts\n",
          stderr: "",
          killed: false,
        };
      }
      return exec(program, args);
    };
    const renamedFromOutside = await completion.runCompletionPipeline({
      projectRoot,
      trusted: true,
      exec: renameExec,
      plan: finalized.snapshot,
      state,
      runLsp: async () => [],
      runReviewer: async () => ({ verdict: "PASS", summary: "Keine Befunde." }),
    });
    equal(
      renamedFromOutside.status,
      "fail",
      "rename source and destination are both scope-checked",
    );
    let secretPatchRead = false;
    let secretReviewerInput;
    const secretExec = async (program, args) => {
      const joined = args.join(" ");
      if (program === "git" && joined.startsWith("status ")) {
        return {
          code: 0,
          stdout: "?? .npmrc\n",
          stderr: "",
          killed: false,
        };
      }
      if (program === "git" && joined === "diff --binary HEAD") {
        secretPatchRead = true;
      }
      return exec(program, args);
    };
    const secretBoundary = await completion.runCompletionPipeline({
      projectRoot,
      trusted: true,
      exec: secretExec,
      plan: finalized.snapshot,
      state,
      runLsp: async () => [],
      runReviewer: async (input) => {
        secretReviewerInput = input;
        return { verdict: "PASS", summary: "Keine Befunde." };
      },
    });
    assert(
      secretBoundary.status === "fail" &&
        !secretPatchRead &&
        secretReviewerInput.changedFiles.length === 0 &&
        secretReviewerInput.diff.includes("nicht an den Reviewer"),
      "secret paths block completion without reading or forwarding their diff",
    );
    const secretOverride = await completion.runCompletionPipeline(
      {
        projectRoot,
        trusted: true,
        exec: secretExec,
        plan: finalized.snapshot,
        state,
        runLsp: async () => [],
        runReviewer: async () => ({
          verdict: "PASS",
          summary: "Keine Befunde.",
        }),
      },
      { overrideReason: "must not bypass secrets" },
    );
    assert(
      secretOverride.report === undefined,
      "hard secret findings cannot produce an override report",
    );
    const reviewFailure = await completion.runCompletionPipeline({
      projectRoot,
      trusted: true,
      exec,
      plan: finalized.snapshot,
      state,
      runLsp: async (files) =>
        files.map((file) => ({
          path: file,
          status: "fail",
          summary: "diagnostic",
        })),
      runReviewer: async () => ({
        verdict: "REWORK",
        summary: "Regression gefunden.",
      }),
    });
    equal(
      reviewFailure.status,
      "fail",
      "LSP or reviewer findings prevent done",
    );

    const profileExec = async (program, args) => {
      if (program === "missing-tool") throw new Error("spawn ENOENT");
      return exec(program, args);
    };
    writeFileSync(
      path.join(projectRoot, ".pi", "verify.json"),
      JSON.stringify({
        profiles: {
          typecheck: {
            program: "true",
            args: [],
            classification: "required",
          },
          optional: {
            program: "missing-tool",
            args: [],
            classification: "recommended",
          },
        },
      }),
    );
    const recommendedMissing = await completion.runCompletionPipeline({
      projectRoot,
      trusted: true,
      exec: profileExec,
      plan: finalized.snapshot,
      state,
      runLsp: async () => [],
      runReviewer: async () => ({ verdict: "PASS", summary: "Keine Befunde." }),
    });
    assert(
      recommendedMissing.status === "pass" &&
        recommendedMissing.residualRisks.some((risk) =>
          risk.includes("project/optional"),
        ),
      "missing recommended tools remain visible residual risks",
    );
    writeFileSync(
      path.join(projectRoot, ".pi", "verify.json"),
      JSON.stringify({
        profiles: {
          typecheck: {
            program: "missing-tool",
            args: [],
            classification: "required",
          },
        },
      }),
    );
    const requiredMissing = await completion.runCompletionPipeline({
      projectRoot,
      trusted: true,
      exec: profileExec,
      plan: finalized.snapshot,
      state,
      runLsp: async () => [],
      runReviewer: async () => ({ verdict: "PASS", summary: "Keine Befunde." }),
    });
    equal(
      requiredMissing.status,
      "blocked",
      "missing required tools block completion",
    );
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

await test("reviewer RPC uses async reviewer and exact result", async () => {
  const handlers = new Map();
  const api = {
    events: {
      on(name, handler) {
        handlers.set(name, handler);
        return () => handlers.delete(name);
      },
      emit(name, request) {
        if (name !== "subagents:rpc:v1:request") return;
        const reply = handlers.get(`subagents:rpc:v1:reply:${request.requestId}`);
        if (request.method === "spawn") {
          queueMicrotask(() =>
            reply?.({ success: true, data: { runId: "review-1" } }),
          );
        } else {
          queueMicrotask(() =>
            reply?.({
              success: true,
              data: {
                state: "completed",
                output: "Go.\n[COMPLETION-REVIEW:PASS]",
              },
            }),
          );
        }
      },
    },
  };
  const result = await reviewerRpc.runCompletionReviewerViaRpc(
    api,
    {
      changedFiles: [],
      diff: "",
      diffHash: "b".repeat(64),
      checks: [],
      scopeFindings: [],
    },
    { pollMs: 10, timeoutMs: 5_000 },
  );
  equal(result.verdict, "PASS", "RPC reviewer PASS is parsed");
});

await test("extension entry drives plan, work, completion, direct task and recovery", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "pi-v3-integration-"));
  const commands = new Map();
  const tools = new Map();
  const shortcuts = new Map();
  const hooks = new Map();
  const events = new Map();
  const notifications = [];
  const sent = [];
  const appended = [];
  const inputQueue = [];
  const selectQueue = [];
  let verificationFails = false;
  const add = (map, name, handler) => {
    const list = map.get(name) ?? [];
    list.push(handler);
    map.set(name, list);
    return () => {
      const index = list.indexOf(handler);
      if (index >= 0) list.splice(index, 1);
    };
  };
  const api = {
    events: {
      on(name, handler) { return add(events, name, handler); },
      emit(name, value) {
        for (const handler of events.get(name) ?? []) handler(value);
        if (name === "lsp:diagnostics:v1:request") {
          value.respond({
            version: 1,
            requestId: value.requestId,
            results: value.files.map((file) => ({
              path: file,
              status: "pass",
              summary: "clean",
            })),
          });
        }
        if (name === "subagents:rpc:v1:request") {
          const reply = `subagents:rpc:v1:reply:${value.requestId}`;
          queueMicrotask(() => {
            api.events.emit(
              reply,
              value.method === "spawn"
                ? { success: true, data: { runId: "integration-review" } }
                : {
                    success: true,
                    data: {
                      state: "completed",
                      results: [
                        {
                          output:
                            "Keine Befunde.\n[COMPLETION-REVIEW:PASS]",
                        },
                      ],
                    },
                  },
            );
          });
        }
      },
    },
    on(name, handler) { add(hooks, name, handler); },
    registerFlag() {},
    registerCommand(name, options) { commands.set(name, options.handler); },
    registerTool(tool) { tools.set(tool.name, tool); },
    registerShortcut(name, options) { shortcuts.set(name, options.handler); },
    getFlag() { return false; },
    appendEntry(type, data) { appended.push({ type, data }); },
    sendMessage(message) { sent.push(message); },
    async exec(program, args) {
      const joined = args.join(" ");
      if (joined.startsWith("status ")) {
        return {
          code: 0,
          stdout: " M extensions/plan-mode/a.ts\n",
          stderr: "",
          killed: false,
        };
      }
      if (joined === "diff --stat HEAD") {
        return { code: 0, stdout: " 1 file changed\n", stderr: "", killed: false };
      }
      if (joined === "diff --binary HEAD") {
        return {
          code: 0,
          stdout: "diff --git a/a b/a\n+ok\n",
          stderr: "",
          killed: false,
        };
      }
      if (verificationFails && program !== "git") {
        return {
          code: 1,
          stdout: "",
          stderr: "intentional verification failure",
          killed: false,
        };
      }
      return { code: 0, stdout: "", stderr: "", killed: false };
    },
  };
  const context = {
    cwd,
    mode: "tui",
    hasUI: true,
    isProjectTrusted: () => true,
    isIdle: () => true,
    sessionManager: {
      getSessionId: () => "integration-session",
      getEntries: () => [],
    },
    ui: {
      notify(message, level) { notifications.push({ message, level }); },
      setStatus() {},
      async select() { return selectQueue.shift(); },
      async confirm() { return true; },
      async input() { return inputQueue.shift(); },
    },
  };
  const runHook = async (name) => {
    const results = [];
    for (const handler of hooks.get(name) ?? []) {
      results.push(await handler({}, context));
    }
    return results;
  };
  try {
    planExtension.default(api);
    await runHook("session_start");
    mkdirSync(path.join(cwd, ".pi"), { recursive: true });
    writeFileSync(
      path.join(cwd, ".pi", "verify.json"),
      JSON.stringify({
        profiles: {
          typecheck: {
            program: "npm",
            args: ["run", "typecheck"],
            classification: "required",
          },
        },
      }),
    );
  for (const command of [
    "plan",
    "review-plan",
    "work",
    "done",
    "finish",
    "task",
    "task-done",
    "migrate-plan",
  ]) {
      assert(commands.has(command), `/${command} is registered`);
  }
    assert(tools.has("plan_progress"), "plan_progress is registered");
    assert(shortcuts.has("shift+tab"), "Shift+Tab control center remains");

    await commands.get("plan")("quick", context);
    const planningContext = await runHook("before_agent_start");
    assert(
      planningContext.some((entry) =>
        entry?.message?.content?.includes("PI WORKFLOW: PLANUNG"),
      ),
      "planning prompt is injected",
    );
    mkdirSync(path.join(cwd, ".agent", "plans"), { recursive: true });
    writeFileSync(path.join(cwd, store.PLAN_RELATIVE_PATH), quickPlan());
    await runHook("agent_settled");
    let loaded = store.loadWorkflowStateV3(cwd);
    assert(Boolean(loaded.snapshot), "agent settlement finalizes PlanSnapshot v3");

    await commands.get("plan-todos")("", context);
    await commands.get("review-plan")("", context);
    await runHook("before_agent_start");
    await runHook("agent_settled");
    await commands.get("work")("", context);
    const workContext = await runHook("before_agent_start");
    assert(
      workContext.some((entry) =>
        entry?.message?.content?.includes("PI WORKFLOW: AUSFÜHRUNG"),
      ),
      "working prompt is injected",
    );
    loaded = store.loadWorkflowStateV3(cwd);
    for (const [index, step] of loaded.snapshot.steps.entries()) {
      if (index === 0) {
        await tools.get("plan_progress").execute(
          "progress-start",
          {
            stepId: step.id,
            status: "in_progress",
            evidence: "started",
          },
          undefined,
          undefined,
          context,
        );
      }
      await tools.get("plan_progress").execute(
        `progress-${index}`,
        {
          stepId: step.id,
          status: "completed",
          evidence: "passed",
        },
        undefined,
        undefined,
        context,
      );
    }
    await runHook("agent_settled");
    assert(
      !existsSync(path.join(cwd, store.PLAN_RELATIVE_PATH)),
      "successful automatic completion archives the active plan",
    );

    inputQueue.push(
      "extensions/**",
      "typecheck",
      "requested behavior works",
    );
    await commands.get("task")("Direct fix", context);
    assert(Boolean(store.loadDirectTask(cwd)), "/task writes direct-task.json");
    await runHook("before_agent_start");
    await commands.get("task-done")("", context);
    assert(!store.loadDirectTask(cwd), "/task-done clears a passing direct task");
    assert(
      appended.some(
        (entry) =>
          entry.type === "workflow-completion" &&
          entry.data.outcome === "passed",
      ),
      "passing direct task records its completion report in the session",
    );

    inputQueue.push(
      "extensions/**",
      "typecheck",
      "known failure is explicitly accepted",
    );
    await commands.get("task")("Direct override", context);
    verificationFails = true;
    inputQueue.push("Bewusster Test-Override für den Regressionstest");
    await commands.get("task-done")("", context);
    verificationFails = false;
    assert(
      !store.loadDirectTask(cwd) &&
        appended.some(
          (entry) =>
            entry.type === "workflow-completion" &&
            entry.data.outcome === "override" &&
            entry.data.overrideReason,
        ),
      "direct-task override is reasoned and recorded before cleanup",
    );

    const second = snapshotMod.finalizePlanDocument(
      quickPlan(),
      "simple_plan",
    );
    let saved = store.writePlanAndStateCAS(
      cwd,
      second.snapshot,
      "missing",
    );
    saved = store.writeWorkflowStateCAS(
      cwd,
      execution.startOrResumeExecution(saved.state),
      saved.stateToken,
    );
    await commands.get("done")("1 2", context);
    assert(
      !existsSync(path.join(cwd, store.PLAN_RELATIVE_PATH)),
      "/done uses the same completion and archive path",
    );

    const disposable = snapshotMod.finalizePlanDocument(
      quickPlan(),
      "simple_plan",
    );
    store.writePlanAndStateCAS(cwd, disposable.snapshot, "missing");
    await commands.get("discard-plan")("", context);
    assert(
      !existsSync(path.join(cwd, store.PLAN_RELATIVE_PATH)),
      "confirmed discard removes active artifacts",
    );

    mkdirSync(path.join(cwd, ".agent", "plans"), { recursive: true });
    writeFileSync(path.join(cwd, store.PLAN_RELATIVE_PATH), quickPlan());
    writeFileSync(
      path.join(cwd, store.WORKFLOW_STATE_RELATIVE_PATH),
      JSON.stringify({ version: 2, phase: "paused" }),
    );
    await commands.get("migrate-plan")("", context);
    equal(
      store.loadWorkflowStateV3(cwd).state.version,
      3,
      "interactive migration writes v3",
    );
    store.acquireWorkflowLock(cwd);
    await commands.get("recover-workflow-lock")("", context);
    await commands.get("finish")("", context);

    selectQueue.push("Berechtigungen");
    await shortcuts.get("shift+tab")(context);
    selectQueue.push(undefined);
    await shortcuts.get("super+p")(context);
    let capability;
    api.events.emit("workflow-capabilities:request", {
      respond(value) { capability = value; },
    });
    assert(Boolean(capability), "workflow capability snapshot is published");
    let thinking;
    api.events.emit("control-center:workflow-thinking-default", {
      respond(value) { thinking = value; },
    });
    assert(Boolean(thinking), "workflow thinking default is published");
    await runHook("session_shutdown");
    assert(sent.length >= 4, "workflow handoffs remain visible messages");
    assert(
      notifications.some((entry) =>
        entry.message.includes("PlanSnapshot v3 gespeichert"),
      ),
      "successful plan finalization is reported",
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

if (failed > 0) {
  console.error(`\nFAIL: ${passed} passed, ${failed} failed`);
  process.exit(1);
}
console.log(`\nPASS: ${passed} passed, 0 failed`);
