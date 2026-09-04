import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, eq, test } from "../shared/assertions.mjs";
import { createHarness, latestStatus } from "../shared/harness.mjs";
import { importModule as load } from "../shared/jiti-loader.mjs";

const planMode = await load("extensions/plan-mode/index.ts");
const modePermissions = await load("extensions/mode-permissions.ts");
const planPrompts = await load("extensions/plan-mode/prompts.ts");
const planStore = await load("extensions/plan-mode/plan-store.ts");
const planCommands = await load("extensions/plan-mode/commands.ts");

async function hooks(harness, name, ctx, event = {}) {
  return harness.runHooks(name, event, ctx);
}

/**
 * Plans live in the runtime's own state directory, so every case has to point
 * `PI_CODING_AGENT_DIR` at a scratch directory of its own. Two cases sharing
 * one would recreate exactly the cross-session collision this design removes.
 */
async function withPlanHome(fn) {
  const previous = process.env.PI_CODING_AGENT_DIR;
  const home = mkdtempSync(join(tmpdir(), "pi-plan-home-"));
  process.env.PI_CODING_AGENT_DIR = home;
  try {
    return await fn(home);
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(home, { recursive: true, force: true });
  }
}

const GOOD_SIMPLE_PLAN = `# Plan

## Ziel
Den Fehler im Login-Formular beheben, damit leere Eingaben abgewiesen werden.

## Vorgehen
Die Validierung in auth/form.ts um eine Prüfung auf leere Felder ergänzen.

## Betroffene Bereiche
auth/form.ts und der zugehörige Test auth/form.test.ts.

## Verifikation
npm test -- auth/form läuft grün, der neue Fall schlägt ohne den Fix fehl.

## Risiken
Bestehende Aufrufer könnten sich auf das alte, tolerante Verhalten verlassen.
`;

const GOOD_DETAILED_PLAN = `# Architekturplan

## Ziel
Die Sitzungsverwaltung von einem globalen Singleton auf eine sitzungsbezogene
Instanz umstellen, damit parallele Sitzungen sich nicht mehr überschreiben.

## Nicht-Ziele
Keine Änderung am Providerprotokoll und keine neue Datenbank.

## Ausgangslage
core/session.ts hält den Zustand als Modulvariable; extensions/plan-mode liest
ihn über readState(). Beide Stellen wurden gelesen.

## Annahmen
Angenommen wird, dass kein externer Konsument readState() importiert; belegt ist
das nur für dieses Repository. Offen bleibt das Verhalten älterer Sitzungen.

## Umsetzung
- Phase 1: Zustand in eine Instanz überführen, alte API als Adapter behalten.
- Phase 2: Aufrufer umstellen und den Adapter entfernen.

## Abhängigkeiten
Phase 2 setzt Phase 1 voraus; die Tests aus Phase 1 bleiben bis zum Ende grün.

## Abschlusskriterien
Phase 1 gilt als fertig, wenn die bestehenden Tests unverändert grün sind.
Phase 2 gilt als fertig, wenn keine Referenz auf den Adapter mehr existiert.

## Verifikation
npm test läuft grün; ein neuer Test startet zwei Sitzungen und erwartet zwei
getrennte Zustände statt eines geteilten.

## Risiken
Kompatibilität für externe Importeure, Datenverlust beim Migrieren alter
Sitzungen und ein Betriebsrisiko, falls die Umstellung halb ausgerollt wird.
`;

async function writePlanViaTool(harness, ctx, content) {
  const tool = harness.tools.get("plan_write");
  return tool.execute("call-1", { content }, undefined, undefined, ctx);
}

async function chooseWorkflow(harness, ctx) {
  await harness.shortcuts.get("shift+tab")(ctx);
}

/** Drive one complete planning turn that produces a valid, settled plan. */
async function runPlanningTurn(harness, ctx, content) {
  await hooks(harness, "before_agent_start", ctx, {
    prompt: "Plane das",
    systemPrompt: "BASE",
  });
  await writePlanViaTool(harness, ctx, content);
  await hooks(harness, "agent_end", ctx, { messages: [{ stopReason: "stop" }] });
  await hooks(harness, "agent_settled", ctx);
}

for (const [label, mode] of [
  ["Schnellplan", "simple_plan"],
  ["Architekturplan", "detailed_plan"],
]) {
  await test(`Shift+Tab → ${label} waits for the real planning prompt`, async () => {
    if (!planMode) return;
    await withPlanHome(async () => {
      const cwd = mkdtempSync(join(tmpdir(), "pi-workflow-plan-"));
      try {
        const harness = createHarness({ select: () => label });
        const ctx = harness.makeContext({ cwd });
        planMode.default(harness.api);
        await hooks(harness, "session_start", ctx);

        await chooseWorkflow(harness, ctx);
        eq(
          latestStatus(harness, "workflow"),
          label,
          `${mode} is active after selection`,
        );
        eq(harness.sent.length, 0, "mode selection sends no synthetic prompt");

        const prompt = await hooks(harness, "before_agent_start", ctx, {
          prompt: "Plane das",
          systemPrompt: "BASE",
        });
        assert(
          prompt[0]?.systemPrompt?.includes("PI PLANMODUS"),
          "the next real user turn receives planning context in its system prompt",
        );
        eq(
          prompt[0]?.message,
          undefined,
          "the mode instruction is not a persisted custom message",
        );
        eq(
          harness.sent.length,
          0,
          "the planning context does not synthesize a user message",
        );
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    });
  });
}

await test("planningPrompt() actively asks the agent to use ask_user for real decisions", async () => {
  if (!planPrompts) return;
  for (const mode of ["simple_plan", "detailed_plan"]) {
    const prompt = planPrompts.planningPrompt(mode);
    assert(
      prompt.includes("ask_user"),
      `${mode} planning prompt references the ask_user tool`,
    );
    assert(
      prompt.includes("kläre sie aktiv"),
      `${mode} planning prompt encourages ask_user on real decisions, not just documenting them as options`,
    );
    assert(
      prompt.includes("einfacher, für Laien verständlicher Sprache"),
      `${mode} planning prompt requires plain-language options`,
    );
    assert(
      prompt.includes("plan_write"),
      `${mode} planning prompt names the only writer`,
    );
  }
});

await test("the two planning prompts state genuinely different requirements", async () => {
  if (!planPrompts) return;
  const simple = planPrompts.planningPrompt("simple_plan");
  const detailed = planPrompts.planningPrompt("detailed_plan");
  assert(
    simple !== detailed,
    "the two prompts are not the same text with a different heading",
  );
  for (const section of [
    "Nicht-Ziele",
    "Annahmen",
    "Abhängigkeiten",
    "Abschlusskriterien",
  ]) {
    assert(
      detailed.includes(section) && !simple.includes(section),
      `${section} is required for the architecture plan only`,
    );
  }
  assert(
    simple.includes("ohne Phasenbürokratie"),
    "the quick plan stays explicitly lightweight",
  );
});

await test("a work turn without an approval carries no plan at all", async () => {
  if (!planMode) return;
  await withPlanHome(async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-workflow-work-"));
    try {
      let choice = "Schnellplan";
      const harness = createHarness({ select: () => choice });
      const ctx = harness.makeContext({ cwd });
      planMode.default(harness.api);
      await hooks(harness, "session_start", ctx);

      await chooseWorkflow(harness, ctx);
      await runPlanningTurn(harness, ctx, GOOD_SIMPLE_PLAN);

      // Leaving plan mode is not an approval. This is the central regression:
      // switching to work used to arm the handoff all by itself.
      choice = "Work";
      await chooseWorkflow(harness, ctx);
      eq(harness.sent.length, 0, "work selection starts no turn");

      const prompt = await hooks(harness, "before_agent_start", ctx, {
        prompt: "Was hältst du davon?",
        systemPrompt: "BASE",
      });
      eq(
        prompt[0],
        undefined,
        "an ordinary work turn adds nothing to the request at all",
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

await test("an explicit approval hands the plan over exactly once, as data", async () => {
  if (!planMode) return;
  await withPlanHome(async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-workflow-approve-"));
    try {
      const harness = createHarness({
        select: () => "Schnellplan",
        input: () => "",
      });
      const ctx = harness.makeContext({ cwd });
      planMode.default(harness.api);
      await hooks(harness, "session_start", ctx);
      await chooseWorkflow(harness, ctx);
      await runPlanningTurn(harness, ctx, GOOD_SIMPLE_PLAN);

      await harness.commands.get("plan-approve")("", ctx);
      const started = harness.lifecycleCalls.filter(
        (call) => call.kind === "sendUserMessage",
      );
      eq(started.length, 1, "approval starts exactly one work turn");
      const executionPrompt = started[0].content;

      // Any other turn must not consume the grant.
      const unrelated = await hooks(harness, "before_agent_start", ctx, {
        prompt: "Kurze Rückfrage vorher",
        systemPrompt: "BASE",
      });
      eq(
        unrelated[0],
        undefined,
        "an intervening question turn does not consume the approval",
      );

      const handoff = await hooks(harness, "before_agent_start", ctx, {
        prompt: executionPrompt,
        systemPrompt: "BASE",
      });
      assert(
        handoff[0]?.systemPrompt?.includes("PI WORKMODUS"),
        "the fixed workflow rules reach the system prompt",
      );
      assert(
        !handoff[0]?.systemPrompt?.includes("Login-Formular"),
        "the plan text itself never becomes a system instruction",
      );
      assert(
        handoff[0]?.message?.content?.includes("Login-Formular"),
        "the plan travels as a separate data message",
      );

      const again = await hooks(harness, "before_agent_start", ctx, {
        prompt: executionPrompt,
        systemPrompt: "BASE",
      });
      eq(
        again[0],
        undefined,
        "one approval cannot power a second execution turn",
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

await test("an approval does not survive a change to the plan it was bound to", async () => {
  if (!planMode || !planStore) return;
  await withPlanHome(async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-workflow-rehash-"));
    try {
      const harness = createHarness({
        select: () => "Schnellplan",
        input: () => "",
      });
      const ctx = harness.makeContext({ cwd });
      planMode.default(harness.api);
      await hooks(harness, "session_start", ctx);
      await chooseWorkflow(harness, ctx);
      await runPlanningTurn(harness, ctx, GOOD_SIMPLE_PLAN);
      await harness.commands.get("plan-approve")("", ctx);
      const executionPrompt = harness.lifecycleCalls
        .filter((call) => call.kind === "sendUserMessage")
        .at(-1).content;

      // Someone edits the plan after the approval — the external editor, or a
      // second session. The grant was bound to the old hash and must be void.
      const location = planStore.planLocation(
        cwd,
        ctx.sessionManager.getSessionId(),
      );
      const current = planStore.readPlan(location);
      planStore.writePlan(
        location,
        `${GOOD_SIMPLE_PLAN}\n## Nachtrag\nEtwas anderes.\n`,
        current.hash,
      );

      const handoff = await hooks(harness, "before_agent_start", ctx, {
        prompt: executionPrompt,
        systemPrompt: "BASE",
      });
      eq(
        handoff[0],
        undefined,
        "a changed plan voids the approval instead of handing over unapproved text",
      );
      assert(
        harness.notifications.some((entry) =>
          entry.message.includes("Freigabe gilt nicht mehr"),
        ),
        "the void approval is reported, not silent",
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

await test("an edit made during the turn survives settling and voids the quality verdict", async () => {
  if (!planMode || !planStore) return;
  await withPlanHome(async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-workflow-edited-"));
    try {
      const harness = createHarness({
        select: () => "Schnellplan",
        input: () => "",
      });
      const ctx = harness.makeContext({ cwd });
      planMode.default(harness.api);
      await hooks(harness, "session_start", ctx);
      await chooseWorkflow(harness, ctx);

      await hooks(harness, "before_agent_start", ctx, {
        prompt: "Plane das",
        systemPrompt: "BASE",
      });
      await writePlanViaTool(harness, ctx, GOOD_SIMPLE_PLAN);
      // The operator edits the plan in the external editor after the agent
      // wrote it. Settling must not roll that edit back.
      const location = planStore.planLocation(
        cwd,
        ctx.sessionManager.getSessionId(),
      );
      const afterAgent = planStore.readPlan(location);
      planStore.writePlan(
        location,
        GOOD_SIMPLE_PLAN.replace("Login-Formular", "Von-Hand-Formular"),
        afterAgent.hash,
      );
      await hooks(harness, "agent_end", ctx, {
        messages: [{ stopReason: "stop" }],
      });
      await hooks(harness, "agent_settled", ctx);

      const stored = planStore.readPlan(location);
      assert(
        stored.content.includes("Von-Hand-Formular"),
        "the operator's own edit is not discarded by settling",
      );
      assert(
        harness.notifications.some((entry) =>
          entry.message.includes("Mindestanforderungen"),
        ),
        "and the plan is reported as unvalidated, because the gate never saw it",
      );

      await harness.commands.get("plan-approve")("", ctx);
      const executionPrompt = harness.lifecycleCalls
        .filter((call) => call.kind === "sendUserMessage")
        .at(-1).content;
      const handoff = await hooks(harness, "before_agent_start", ctx, {
        prompt: executionPrompt,
        systemPrompt: "BASE",
      });
      assert(
        handoff[0]?.message?.content?.includes("Von-Hand-Formular"),
        "approving hands over the edited plan the operator actually saw",
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

await test("a settled plan ignores retry intermediates", async () => {
  if (!planMode) return;
  await withPlanHome(async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-workflow-retry-"));
    try {
      const harness = createHarness({
        select: () => "Schnellplan",
        input: () => "",
      });
      const ctx = harness.makeContext({ cwd });
      planMode.default(harness.api);
      await hooks(harness, "session_start", ctx);
      await chooseWorkflow(harness, ctx);

      await hooks(harness, "before_agent_start", ctx, {
        prompt: "Plane das",
        systemPrompt: "BASE",
      });
      await writePlanViaTool(
        harness,
        ctx,
        GOOD_SIMPLE_PLAN.replace("Login-Formular", "Zwischenstand-Formular"),
      );
      // A low-level agent_end before a retry must not freeze the intermediate.
      await hooks(harness, "agent_end", ctx, {
        messages: [{ stopReason: "error" }],
      });
      await writePlanViaTool(harness, ctx, GOOD_SIMPLE_PLAN);
      await hooks(harness, "agent_end", ctx, {
        messages: [{ stopReason: "stop" }],
      });
      await hooks(harness, "agent_settled", ctx);

      await harness.commands.get("plan-approve")("", ctx);
      const executionPrompt = harness.lifecycleCalls
        .filter((call) => call.kind === "sendUserMessage")
        .at(-1).content;
      const handoff = await hooks(harness, "before_agent_start", ctx, {
        prompt: executionPrompt,
        systemPrompt: "BASE",
      });
      assert(
        handoff[0]?.message?.content?.includes("Login-Formular"),
        "the plan that survived the retry is the one handed over",
      );
      assert(
        !handoff[0]?.message?.content?.includes("Zwischenstand-Formular"),
        "an earlier low-level agent_end cannot freeze a retry intermediate",
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

for (const [name, endMessages] of [
  ["a provider error", [{ stopReason: "error", errorMessage: "boom" }]],
  ["a user abort", [{ stopReason: "aborted" }]],
]) {
  await test(`${name} restores the previous plan and offers nothing`, async () => {
    if (!planMode || !planStore) return;
    await withPlanHome(async () => {
      const cwd = mkdtempSync(join(tmpdir(), "pi-workflow-fail-"));
      try {
        const harness = createHarness({
          select: () => "Schnellplan",
          input: () => "",
        });
        const ctx = harness.makeContext({ cwd });
        planMode.default(harness.api);
        await hooks(harness, "session_start", ctx);
        await chooseWorkflow(harness, ctx);
        await runPlanningTurn(harness, ctx, GOOD_SIMPLE_PLAN);

        await hooks(harness, "before_agent_start", ctx, {
          prompt: "Plane neu",
          systemPrompt: "BASE",
        });
        await writePlanViaTool(
          harness,
          ctx,
          GOOD_SIMPLE_PLAN.replace("Login-Formular", "Halbfertig-Formular"),
        );
        await hooks(harness, "agent_end", ctx, { messages: endMessages });
        await hooks(harness, "agent_settled", ctx);

        const stored = planStore.readPlan(
          planStore.planLocation(cwd, ctx.sessionManager.getSessionId()),
        );
        assert(
          stored.content.includes("Login-Formular"),
          `${name} restores the plan that was there before the run`,
        );
        await harness.commands.get("plan-approve")("", ctx);
        // The restored plan is a real plan, so approving it is legitimate —
        // what must not happen is the failed run's half-written text winning.
        const executionPrompt = harness.lifecycleCalls
          .filter((call) => call.kind === "sendUserMessage")
          .at(-1).content;
        const handoff = await hooks(harness, "before_agent_start", ctx, {
          prompt: executionPrompt,
          systemPrompt: "BASE",
        });
        assert(
          !handoff[0]?.message?.content?.includes("Halbfertig-Formular"),
          `${name} never hands over the interrupted run's text`,
        );
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    });
  });
}

await test("a resumed session never executes a plan from an earlier session", async () => {
  if (!planMode || !planStore) return;
  await withPlanHome(async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-workflow-resume-"));
    try {
      const harness = createHarness({
        select: () => "Schnellplan",
        input: () => "",
      });
      const ctx = harness.makeContext({ cwd });
      planMode.default(harness.api);
      await hooks(harness, "session_start", ctx);
      await chooseWorkflow(harness, ctx);
      await runPlanningTurn(harness, ctx, GOOD_SIMPLE_PLAN);
      await harness.commands.get("plan-approve")("", ctx);
      const executionPrompt = harness.lifecycleCalls
        .filter((call) => call.kind === "sendUserMessage")
        .at(-1).content;

      // Restart: the plan file is still on disk, the grant is not.
      await hooks(harness, "session_start", ctx);
      const stored = planStore.readPlan(
        planStore.planLocation(cwd, ctx.sessionManager.getSessionId()),
      );
      assert(stored, "the plan file itself survives the restart");
      const handoff = await hooks(harness, "before_agent_start", ctx, {
        prompt: executionPrompt,
        systemPrompt: "BASE",
      });
      eq(
        handoff[0],
        undefined,
        "an approval from before the restart is gone",
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

await test("a legacy .agent plan file is displayed but never executed", async () => {
  if (!planMode) return;
  await withPlanHome(async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-workflow-legacy-"));
    try {
      const harness = createHarness();
      const ctx = harness.makeContext({ cwd });
      planMode.default(harness.api);
      await hooks(harness, "session_start", ctx);
      mkdirSync(join(cwd, ".agent", "plans"), { recursive: true });
      writeFileSync(
        join(cwd, ".agent", "plans", "current-plan.md"),
        "# Plan der alten Sitzung\n",
      );

      await harness.commands.get("view-plan")("", ctx);
      const shown = harness.notifications.at(-1)?.message ?? "";
      assert(
        shown.includes("Plan der alten Sitzung"),
        "the legacy plan is shown on request",
      );
      assert(
        shown.includes("nie automatisch ausgeführt"),
        "and is labelled as never executed automatically",
      );

      const prompt = await hooks(harness, "before_agent_start", ctx, {
        prompt: "Mach was",
        systemPrompt: "BASE",
      });
      eq(prompt[0], undefined, "a work turn ignores the legacy plan file");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

await test("two sessions in one checkout keep separate plans", async () => {
  if (!planMode || !planStore) return;
  await withPlanHome(async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-workflow-parallel-"));
    try {
      const results = [];
      for (const sessionId of ["session-a", "session-b"]) {
        const harness = createHarness({
          select: () => "Schnellplan",
          sessionId,
        });
        const ctx = harness.makeContext({ cwd, sessionId });
        planMode.default(harness.api);
        await hooks(harness, "session_start", ctx);
        await chooseWorkflow(harness, ctx);
        await runPlanningTurn(
          harness,
          ctx,
          GOOD_SIMPLE_PLAN.replace("Login-Formular", `${sessionId}-Formular`),
        );
        results.push(sessionId);
      }
      for (const sessionId of results) {
        const stored = planStore.readPlan(planStore.planLocation(cwd, sessionId));
        assert(
          stored.content.includes(`${sessionId}-Formular`),
          `${sessionId} still has its own plan after the other session ran`,
        );
      }
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

await test("a failed turn's rollback cannot undo another session's plan", async () => {
  if (!planMode || !planStore) return;
  await withPlanHome(async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-workflow-rollback-"));
    try {
      const otherLocation = planStore.planLocation(cwd, "session-other");
      planStore.writePlan(otherLocation, GOOD_SIMPLE_PLAN, undefined);

      const harness = createHarness({
        select: () => "Schnellplan",
        sessionId: "session-mine",
      });
      const ctx = harness.makeContext({ cwd, sessionId: "session-mine" });
      planMode.default(harness.api);
      await hooks(harness, "session_start", ctx);
      await chooseWorkflow(harness, ctx);
      await hooks(harness, "before_agent_start", ctx, {
        prompt: "Plane das",
        systemPrompt: "BASE",
      });
      await writePlanViaTool(
        harness,
        ctx,
        GOOD_SIMPLE_PLAN.replace("Login-Formular", "Mein-Formular"),
      );
      await hooks(harness, "agent_end", ctx, {
        messages: [{ stopReason: "aborted" }],
      });
      await hooks(harness, "agent_settled", ctx);

      const other = planStore.readPlan(otherLocation);
      assert(
        other?.content === GOOD_SIMPLE_PLAN,
        "the other session's plan is untouched by our rollback",
      );
      eq(
        planStore.readPlan(planStore.planLocation(cwd, "session-mine")),
        undefined,
        "our own aborted run leaves no plan behind",
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

await test("a mode switch during a running turn cannot loosen that turn's guards", async () => {
  if (!planMode || !modePermissions) return;
  await withPlanHome(async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-workflow-toctou-"));
    try {
      let choice = "Architekturplan";
      const harness = createHarness({ select: () => choice });
      planMode.default(harness.api);
      modePermissions.default(harness.api);
      const ctx = harness.makeContext({ cwd });
      await hooks(harness, "session_start", ctx);
      await chooseWorkflow(harness, ctx);

      // The planning turn starts; its mode is pinned here.
      await hooks(harness, "before_agent_start", ctx, {
        prompt: "Plane das",
        systemPrompt: "BASE",
      });

      // Mid-turn the user picks Work. The runtime dispatches shortcuts without
      // any idle gate, so this really can happen while the agent is running.
      choice = "Work";
      await chooseWorkflow(harness, ctx);

      const blocked = await harness.runHooks(
        "tool_call",
        { toolName: "write", input: { path: "src/example.ts" } },
        ctx,
      );
      assert(
        blocked.some((entry) => entry?.block),
        "the running planning turn keeps its write ban",
      );
      assert(
        harness.notifications.some((entry) =>
          entry.message.includes("vorgemerkt"),
        ),
        "the deferred switch is visible to the user",
      );

      // Only once the turn settles does the switch take effect.
      await hooks(harness, "agent_settled", ctx);
      const allowed = await harness.runHooks(
        "tool_call",
        { toolName: "write", input: { path: "src/example.ts" } },
        ctx,
      );
      assert(
        !allowed.some((entry) => entry?.block),
        "after the turn settles, work mode applies",
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

await test("Plan Mode blocks every project write, including the old plan path", async () => {
  if (!planMode || !modePermissions) return;
  await withPlanHome(async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-plan-mode-guard-"));
    try {
      const harness = createHarness({ select: () => "Architekturplan" });
      planMode.default(harness.api);
      modePermissions.default(harness.api);
      const ctx = harness.makeContext({ cwd });
      await hooks(harness, "session_start", ctx);
      await chooseWorkflow(harness, ctx);

      const writeEvent = (path) => ({ toolName: "write", input: { path } });
      // The plan no longer lives in the project, so the write hole it used to
      // need is gone: plan mode's project-write surface is empty.
      for (const path of [".agent/plans/current-plan.md", "src/example.ts"]) {
        const result = await harness.runHooks("tool_call", writeEvent(path), ctx);
        assert(
          result.some((entry) => entry?.block),
          `${path} is not writable while planning`,
        );
      }
      const planWrite = await harness.runHooks(
        "tool_call",
        { toolName: "plan_write", input: { content: "x" } },
        ctx,
      );
      assert(
        !planWrite.some((entry) => entry?.block),
        "plan_write is the one writer plan mode admits",
      );

      for (const event of [
        { toolName: "bash", input: { command: "npm test" } },
        { toolName: "bash", input: { command: "npm run build" } },
        { toolName: "project_check", input: { profile: "verify" } },
        {
          toolName: "subagent",
          input: { agent: "verifier", task: "x", output: "report.md" },
        },
      ]) {
        const result = await harness.runHooks("tool_call", event, ctx);
        assert(
          result.some((entry) => entry?.block),
          `${event.toolName} cannot bypass Plan Mode`,
        );
      }
      for (const command of [
        "git status",
        "git diff",
        "git log",
        "rg plan extensions",
      ]) {
        const result = await harness.runHooks(
          "tool_call",
          { toolName: "bash", input: { command } },
          ctx,
        );
        assert(
          !result.some((entry) => entry?.block),
          `${command} remains read-only in Plan Mode`,
        );
      }

      await harness.commands.get("permission")("confirm-all", ctx);
      let result = await harness.runHooks(
        "tool_call",
        writeEvent("src/example.ts"),
        ctx,
      );
      assert(
        result.some((entry) => entry?.block),
        "confirm-all keeps the planning guard",
      );

      await harness.commands.get("permission")("yolo", ctx);
      const denied = harness.appended.filter(
        (entry) => entry.customType === "permission-transition-denied",
      );
      assert(
        denied.length >= 1,
        "a YOLO attempt in plan mode is audited as denied",
      );
      eq(
        denied.at(-1)?.data.attemptedLevel,
        "yolo",
        "the denied entry names the attempted level",
      );
      result = await harness.runHooks(
        "tool_call",
        writeEvent("src/example.ts"),
        ctx,
      );
      assert(
        result.some((entry) => entry?.block),
        "the denied YOLO attempt does not lift the planning guard",
      );
      eq(
        latestStatus(harness, "permissions"),
        "🛡 MANUELL · CONFIRM ALL",
        "a denied YOLO attempt leaves the permission level unchanged",
      );

      await harness.commands.get("permission")("readonly", ctx);
      result = await harness.runHooks(
        "tool_call",
        writeEvent("src/example.ts"),
        ctx,
      );
      assert(
        result.some((entry) => entry?.block),
        "readonly still blocks project writes",
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

await test("approval keeps the permission level and every hard gate", async () => {
  if (!planMode || !modePermissions) return;
  await withPlanHome(async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-plan-approve-perm-"));
    try {
      const harness = createHarness({
        select: () => "Schnellplan",
        input: () => "",
      });
      planMode.default(harness.api);
      modePermissions.default(harness.api);
      const ctx = harness.makeContext({ cwd });
      await hooks(harness, "session_start", ctx);
      await harness.commands.get("permission")("confirm-all", ctx);
      await chooseWorkflow(harness, ctx);
      await runPlanningTurn(harness, ctx, GOOD_SIMPLE_PLAN);
      await harness.commands.get("plan-approve")("", ctx);

      eq(
        latestStatus(harness, "permissions"),
        "🛡 MANUELL · CONFIRM ALL",
        "approving a plan never raises the permission level",
      );
      assert(
        !harness.appended.some(
          (entry) =>
            entry.customType === "permission-transition" &&
            entry.data.effectiveLevel === "yolo",
        ),
        "approval never enters YOLO",
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

await test("an untrusted project refuses plan mode entirely", async () => {
  if (!planMode) return;
  await withPlanHome(async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-plan-untrusted-"));
    try {
      const harness = createHarness({ select: () => "Schnellplan" });
      const ctx = harness.makeContext({ cwd, trusted: false });
      planMode.default(harness.api);
      await hooks(harness, "session_start", ctx);
      await chooseWorkflow(harness, ctx);
      eq(
        latestStatus(harness, "workflow"),
        "Work",
        "an untrusted project stays in work mode",
      );
      assert(
        harness.notifications.some((entry) =>
          entry.message.includes("Harte Trust-Grenze"),
        ),
        "the refusal is explicit",
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

await test("both plan modes admit only the normalized Investigator SINGLE call", async () => {
  if (!planMode || !modePermissions) return;
  await withPlanHome(async () => {
    for (const label of ["Schnellplan", "Architekturplan"]) {
      const cwd = mkdtempSync(join(tmpdir(), "pi-plan-investigator-"));
      try {
        const harness = createHarness({ select: () => label });
        planMode.default(harness.api);
        modePermissions.default(harness.api);
        const ctx = harness.makeContext({ cwd });
        await hooks(harness, "session_start", ctx);
        await chooseWorkflow(harness, ctx);

        const investigatorInput = {
          agent: "investigator",
          task: "Locate the relevant implementation",
        };
        let result = await harness.runHooks(
          "tool_call",
          { toolName: "subagent", input: investigatorInput },
          ctx,
        );
        assert(
          !result.some((entry) => entry?.block),
          `${label} permits Investigator SINGLE`,
        );
        eq(
          investigatorInput.artifacts,
          false,
          `${label} disables package debug artifacts before execution`,
        );

        for (const [input, labelSuffix] of [
          [{ agent: "debugger", task: "x" }, "debugger"],
          [{ agent: "verifier", task: "x" }, "verifier"],
          [{ agent: "unknown", task: "x" }, "unknown role"],
          [{ agent: "investigator", task: "x", action: "list" }, "action"],
          [{ agent: "investigator", task: "x", async: true }, "async"],
          [{ agent: "investigator", task: "x", output: "report.md" }, "output"],
          [{ agent: "investigator", task: "x", artifacts: true }, "artifacts"],
          [{ agent: "investigator", task: "x", context: "fork" }, "context"],
          [{ agent: "investigator", task: "x", cwd: "/tmp" }, "cwd"],
          [{ agent: "investigator", task: "x", skill: "extra" }, "skill"],
        ]) {
          result = await harness.runHooks(
            "tool_call",
            { toolName: "subagent", input },
            ctx,
          );
          assert(
            result.some((entry) => entry?.block),
            `${label} blocks ${labelSuffix} subagent input`,
          );
        }
        result = await harness.runHooks(
          "tool_call",
          { toolName: "frobnicate", input: {} },
          ctx,
        );
        assert(
          result.some((entry) => entry?.block),
          `${label} keeps unknown custom tools blocked`,
        );
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    }
  });
});

await test("YOLO stays available in work mode but never unlocks plan mode", async () => {
  if (!planMode || !modePermissions) return;
  await withPlanHome(async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-yolo-lock-"));
    try {
      const harness = createHarness({ select: () => "Architekturplan" });
      planMode.default(harness.api);
      modePermissions.default(harness.api);
      const ctx = harness.makeContext({ cwd });
      await hooks(harness, "session_start", ctx);

      await harness.commands.get("yolo")("", ctx);
      eq(
        latestStatus(harness, "permissions"),
        "⚠ YOLO · TEMPORÄR",
        "work mode still allows entering YOLO",
      );
      let result = await harness.runHooks(
        "tool_call",
        { toolName: "write", input: { path: "src/example.ts" } },
        ctx,
      );
      assert(
        !result.some((entry) => entry?.block),
        "YOLO keeps its ordinary meaning in work mode",
      );

      await chooseWorkflow(harness, ctx);
      for (const path of ["src/example.ts", ".agent/plans/current-plan.md"]) {
        result = await harness.runHooks(
          "tool_call",
          { toolName: "write", input: { path } },
          ctx,
        );
        assert(
          result.some((entry) => entry?.block),
          `an active YOLO does not unlock ${path} in plan mode`,
        );
      }

      await harness.commands.get("yolo")("", ctx);
      eq(
        latestStatus(harness, "permissions"),
        "🛡 DEFAULT · PROJECT WRITE",
        "leaving YOLO stays possible while planning",
      );
      eq(
        harness.appended.filter(
          (entry) => entry.customType === "permission-transition-denied",
        ).length,
        0,
        "toggling YOLO off is never a denied attempt",
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

await test("the plan decision stays out of the generic command palette", async () => {
  if (!planMode) return;
  const commandCenter = await load("extensions/plan-mode/command-center.ts");
  if (!commandCenter) return;
  const entries = commandCenter.buildCommandCenterEntries([], {
    activeMode: "simple_plan",
  });
  const labels = entries.flatMap((category) =>
    (category.children ?? []).map((child) => child.label),
  );
  // Shift+Tab owns the workflow switch and the plan decision. Super+Q must not
  // become a second route to them — `tests/suites/ui.mjs` asserts the same
  // contract from the UI side, and this pins the reason rather than the symptom.
  for (const name of ["workflow-set", "plan-decide", "plan-approve"]) {
    assert(
      !labels.some((label) => label.endsWith(`/${name}`)),
      `/${name} changes workflow state and is not offered in the command palette`,
    );
  }
  // Plan tools that change no state stay available there.
  for (const name of ["view-plan", "edit-plan", "save-plan"]) {
    assert(
      labels.some((label) => label.endsWith(`/${name}`)),
      `/${name} is a plain plan tool and stays in the command palette`,
    );
  }
});

await test("the execution prompt is a stable, bindable string", () => {
  if (!planCommands) return;
  eq(
    planCommands.planExecutionPrompt(),
    planCommands.PLAN_EXECUTION_PROMPT,
    "the default execution prompt is the constant the grant binds to",
  );
  assert(
    planCommands
      .planExecutionPrompt("Nur Phase 1")
      .startsWith(planCommands.PLAN_EXECUTION_PROMPT),
    "an added instruction extends the prompt rather than replacing it",
  );
});
