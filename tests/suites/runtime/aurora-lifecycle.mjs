// Regression coverage for the Aurora TUI reliability/consistency rework
// (see docs/decisions and the "gezielte Ueberarbeitung" work order): each
// case here reproduces one of the 16 known bugs against the *current*
// implementation before any fix lands, so every assertion below is written
// for the DESIRED (post-fix) behaviour and is expected to fail until the
// corresponding phase is implemented.
import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { assert } from "../../shared/assertions.mjs";
import { createHarness, stripAnsi } from "../../shared/harness.mjs";

function outgoingEpoch(harness, auroraState) {
  const outgoing = harness.emitted.find(
    (e) =>
      e.name === auroraState.AURORA_UI_CHANNELS.request &&
      e.event.requester === "aurora-ui",
  );
  return outgoing?.event.sessionEpoch;
}

function emitPatch(harness, auroraState, sessionEpoch, patch) {
  harness.api.events.emit(auroraState.AURORA_UI_CHANNELS.patch, {
    type: "patch",
    sessionEpoch,
    source: "lifecycle-test-provider",
    patch,
  });
}

function renderWidget(harness, ctx, columns = 100, rows = 30) {
  const factory = harness.widgets.get("aurora-ui/activity")?.content;
  if (typeof factory !== "function") return [];
  return factory(
    { terminal: { columns, rows }, requestRender() {} },
    ctx.ui.theme,
  )
    .render(columns)
    .map(stripAnsi);
}

/**
 * `/dashboard` persists its choice under getAgentDir(), so any two cases that
 * both drive it would otherwise leak a mode across each other (and into
 * whichever case runs next) through the *same* temp agent dir. Each case
 * that touches /dashboard gets its own throwaway one instead.
 */
async function withIsolatedAgentDir(fn) {
  const previous = process.env.PI_CODING_AGENT_DIR;
  const dir = mkdtempSync(path.join(tmpdir(), "aurora-lifecycle-dashboard-"));
  process.env.PI_CODING_AGENT_DIR = dir;
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
}

export const auroraLifecycleSections = {
  "Aurora UI lifecycle regression coverage": async (context) => {
    const { section, load, auroraUi, auroraState } = context;

    await section("Aurora UI lifecycle regression coverage", async () => {
      if (!auroraUi || !auroraState) return;

      {
        // --- T1: dashboard height budget with framed tiles (Problem 1) ---
        {
          const task = {
            title: "Budget-Test-Aufgabe",
            phase: "work",
            phaseLabel: "Arbeiten",
            workflowMode: "work",
            findings: [],
            receipts: [],
            subagents: [],
            contextPercent: null,
          };
          const theme = createHarness().theme;
          const activityLines = Array.from(
            { length: 20 },
            (_, i) => `Werkzeugzeile ${i}`,
          );
          const maxRows = 6;
          const lines = auroraUi.renderDashboard(task, theme, 140, {
            activityLines,
            maxRows,
            compact: false,
            activity: "running",
          });
          assert(
            lines.length <= maxRows,
            `renderDashboard honours maxRows in the non-compact tile path (got ${lines.length} rows for a budget of ${maxRows})`,
          );
          assert(
            lines.length === 0 || lines.at(-1).includes("╰"),
            "a budget-limited dashboard still ends on a complete tile frame, never a mid-tile cut",
          );
        }

        // --- T2: /inspect must not show data staled by dashboardMode "hidden" (Problem 2) ---
        await withIsolatedAgentDir(async () => {
          let selectedLabel = "Prüfnachweise";
          const harness = createHarness({ select: () => selectedLabel });
          auroraUi.default(harness.api);
          const ctx = harness.makeContext({
            cwd: path.join(homedir(), "projects", "aurora-t2"),
            sessionId: "aurora-t2",
          });
          await harness.runHooks("session_start", {}, ctx);
          const sessionEpoch = outgoingEpoch(harness, auroraState);

          emitPatch(harness, auroraState, sessionEpoch, {
            verification: {
              status: "checks_failed",
              declaredRequiredIds: ["typecheck"],
              requiredOutcomes: { typecheck: "failed" },
              blockingRecommendedIds: [],
            },
          });
          // One render in the default "auto" mode is what real usage does
          // before ever switching to hidden - this is what populates the
          // task projection the inspector reuses.
          renderWidget(harness, ctx, 120, 30);

          await ctx.ui.submitSlashCommand("/dashboard hidden");
          emitPatch(harness, auroraState, sessionEpoch, {
            verification: {
              status: "verified",
              declaredRequiredIds: ["typecheck"],
              requiredOutcomes: { typecheck: "success" },
              blockingRecommendedIds: [],
            },
          });
          // The widget is still rendered every frame while hidden (Pi keeps
          // calling it); only its *content* collapses to []. The task
          // projection must still be kept current regardless.
          renderWidget(harness, ctx, 120, 30);

          const inspectCommand = harness.commands.get("inspect");
          harness.notifications.length = 0;
          await inspectCommand("", ctx);
          const notified = stripAnsi(
            harness.notifications.at(-1)?.message ?? "",
          );
          assert(
            notified.includes("READY") && !notified.includes("NOT_READY"),
            "the inspector reflects the current verification state even while dashboardMode is hidden",
          );
          await harness.runHooks("session_shutdown", {}, ctx);
        });

        // --- T3: an unnormalized "Verify: verified" footer string must not
        // block the idle "done" phase (Problem 3) ---
        {
          const harness = createHarness();
          auroraUi.default(harness.api);
          const ctx = harness.makeContext({ sessionId: "aurora-t3" });
          await harness.runHooks("session_start", {}, ctx);
          await harness.runHooks("agent_start", {}, ctx);
          await harness.runHooks("agent_settled", {}, ctx);

          const footerData = {
            getExtensionStatuses: () =>
              new Map([["verification", "Verify: verified"]]),
            onBranchChange: () => () => {},
          };
          const footer = harness.footerFactory?.(
            { terminal: { rows: 24 }, requestRender() {} },
            ctx.ui.theme,
            footerData,
          );
          footer?.render(100);

          const lines = renderWidget(harness, ctx, 120, 30);
          assert(
            lines.some((line) =>
              line.includes("Letzte Aufgabe abgeschlossen."),
            ),
            "an idle turn with a real 'verified' status reaches the done phase even through the footer's prefixed string",
          );
          await harness.runHooks("session_shutdown", {}, ctx);
        }

        // --- T4: expanded must never show less than auto at the same
        // terminal size (Problem 13) ---
        await withIsolatedAgentDir(async () => {
          const layouts = [
            { name: "compact", columns: 40, rows: 12 },
            { name: "standard", columns: 60, rows: 20 },
            { name: "comfortable", columns: 100, rows: 28 },
            { name: "wide", columns: 130, rows: 32 },
          ];
          for (const layout of layouts) {
            const harness = createHarness();
            auroraUi.default(harness.api);
            const ctx = harness.makeContext({
              sessionId: `aurora-t4-${layout.name}`,
            });
            await harness.runHooks("session_start", {}, ctx);
            await harness.runHooks("agent_start", {}, ctx);
            for (let i = 0; i < 5; i += 1) {
              await harness.runHooks(
                "tool_execution_start",
                {
                  toolCallId: `t4-${layout.name}-${i}`,
                  toolName: "bash",
                  args: { command: `echo ${i}` },
                },
                ctx,
              );
            }

            await ctx.ui.submitSlashCommand("/dashboard auto");
            const autoLines = renderWidget(
              harness,
              ctx,
              layout.columns,
              layout.rows,
            );
            const autoCount = autoLines.filter((l) =>
              l.includes("BEFEHL"),
            ).length;

            await ctx.ui.submitSlashCommand("/dashboard expanded");
            const expandedLines = renderWidget(
              harness,
              ctx,
              layout.columns,
              layout.rows,
            );
            const expandedCount = expandedLines.filter((l) =>
              l.includes("BEFEHL"),
            ).length;

            assert(
              expandedCount >= autoCount,
              `expanded shows at least as many visible tools as auto at ${layout.name} (${layout.columns}x${layout.rows}): auto=${autoCount}, expanded=${expandedCount}`,
            );
            await harness.runHooks("session_shutdown", {}, ctx);
          }
        });

        // --- T5: an earlier tool failure must not out-live a later
        // successful tool and a clean turn end (Problem 6) ---
        {
          const harness = createHarness();
          auroraUi.default(harness.api);
          const ctx = harness.makeContext({ sessionId: "aurora-t5" });
          await harness.runHooks("session_start", {}, ctx);
          await harness.runHooks("agent_start", {}, ctx);
          await harness.runHooks(
            "tool_execution_start",
            {
              toolCallId: "t5-a",
              toolName: "bash",
              args: { command: "false" },
            },
            ctx,
          );
          await harness.runHooks(
            "tool_execution_end",
            {
              toolCallId: "t5-a",
              toolName: "bash",
              isError: true,
              result: "exit 1",
            },
            ctx,
          );
          await harness.runHooks(
            "tool_execution_start",
            { toolCallId: "t5-b", toolName: "bash", args: { command: "true" } },
            ctx,
          );
          await harness.runHooks(
            "tool_execution_end",
            {
              toolCallId: "t5-b",
              toolName: "bash",
              isError: false,
              result: "ok",
            },
            ctx,
          );
          await harness.runHooks(
            "agent_end",
            {
              messages: [
                { role: "assistant", content: "", stopReason: "stop" },
              ],
            },
            ctx,
          );
          await harness.runHooks("agent_settled", {}, ctx);

          const lines = renderWidget(harness, ctx, 120, 30);
          assert(
            !lines.some((line) => line.includes("FEHLER")),
            "a turn that ends cleanly after an earlier, already-superseded tool failure does not show FEHLER",
          );
          await harness.runHooks("session_shutdown", {}, ctx);
        }

        // --- T6: agent_settled must distinguish a real provider error from
        // a real user abort (Problems 5 and 7) ---
        {
          async function settledBadge(stopReason, errorMessage) {
            const harness = createHarness();
            auroraUi.default(harness.api);
            const ctx = harness.makeContext({
              sessionId: `aurora-t6-${stopReason}`,
            });
            await harness.runHooks("session_start", {}, ctx);
            await harness.runHooks("agent_start", {}, ctx);
            await harness.runHooks(
              "agent_end",
              {
                messages: [
                  { role: "assistant", content: "", stopReason, errorMessage },
                ],
              },
              ctx,
            );
            await harness.runHooks("agent_settled", {}, ctx);
            const lines = renderWidget(harness, ctx, 120, 30);
            await harness.runHooks("session_shutdown", {}, ctx);
            return lines.join("\n");
          }

          const errorRun = await settledBadge(
            "error",
            "Provider nicht erreichbar",
          );
          const abortedRun = await settledBadge("aborted", undefined);
          assert(
            errorRun.includes("FEHLER"),
            "a turn that really ended in a provider error shows FEHLER",
          );
          assert(
            !abortedRun.includes("FEHLER") &&
              !abortedRun.includes("ABGESCHLOSSEN"),
            "a user-aborted turn is shown neither as FEHLER nor as a clean ABGESCHLOSSEN completion",
          );
          assert(
            errorRun !== abortedRun,
            "a provider error and a user abort render as visibly different outcomes",
          );
        }

        // --- T7: several simultaneous footer risks must not silently wipe
        // out critical segments, and the folder anchor must survive
        // (Problems 8, 10, 11) ---
        {
          const harness = createHarness({ contextPercent: 95 });
          auroraUi.default(harness.api);
          const cwd = path.join(homedir(), "work");
          const ctx = harness.makeContext({ cwd, sessionId: "aurora-t7" });
          await harness.runHooks("session_start", {}, ctx);
          const sessionEpoch = outgoingEpoch(harness, auroraState);
          emitPatch(harness, auroraState, sessionEpoch, {
            workflow: { phase: "work", label: "Work" },
            permissions: { level: "yolo" },
          });

          const footerData = {
            getExtensionStatuses: () =>
              new Map([
                ["recovery", "⚠ Sperre aktiv"],
                ["verification", "Verify: checks_failed"],
                ["lsp", "eingeschränkt"],
              ]),
            onBranchChange: () => () => {},
          };
          const footer = harness.footerFactory?.(
            { terminal: { rows: 24 }, requestRender() {} },
            ctx.ui.theme,
            footerData,
          );
          const narrow = stripAnsi(footer?.render(45)[0] ?? "");

          assert(
            narrow.includes("~/work") || narrow.includes("work"),
            "the working-directory orientation segment survives narrow, risk-heavy footers instead of being dropped like routine metadata",
          );
          assert(
            /⚠\s*\d+/.test(narrow),
            "several simultaneous critical risks are aggregated into a visible count instead of being silently lost one by one",
          );
          await harness.runHooks("session_shutdown", {}, ctx);
        }

        // --- T8: an old plan title must not survive an unrelated new
        // prompt outside planning mode (Problem 14) ---
        await withIsolatedAgentDir(async () => {
          const planStore = await load("extensions/plan-mode/plan-store.ts");
          if (planStore) {
            const harness = createHarness();
            auroraUi.default(harness.api);
            const cwd = mkdtempSync(path.join(tmpdir(), "aurora-t8-cwd-"));
            const ctx = harness.makeContext({ cwd, sessionId: "aurora-t8" });
            try {
              await harness.runHooks("session_start", {}, ctx);
              const sessionEpoch = outgoingEpoch(harness, auroraState);
              emitPatch(harness, auroraState, sessionEpoch, {
                workflow: { phase: "detailed_plan", label: "Architekturplan" },
              });

              const location = planStore.planLocation(cwd, "aurora-t8");
              planStore.writePlan(
                location,
                "# Plan A: Altes Vorhaben\n\nZiel: Migration abschliessen.",
                undefined,
              );
              await harness.runHooks("agent_start", {}, ctx);
              await harness.runHooks("agent_settled", {}, ctx);

              // The user leaves planning and starts a brand-new, unrelated
              // task without ever re-entering a planning turn.
              emitPatch(harness, auroraState, sessionEpoch, {
                workflow: { phase: "work", label: "Work" },
              });
              await harness.runHooks(
                "before_agent_start",
                { prompt: "Behebe den Login-Bug in auth.ts" },
                ctx,
              );
              await harness.runHooks("agent_start", {}, ctx);
              await harness.runHooks("agent_settled", {}, ctx);

              const lines = renderWidget(harness, ctx, 120, 30);
              assert(
                !lines.some((line) =>
                  line.includes("Behebe den Login-Bug in auth.ts"),
                ),
                "the activity dashboard omits the redundant task title",
              );
              assert(
                !lines.some((line) => line.includes("Plan A: Altes Vorhaben")),
                "the old plan title from a finished planning turn no longer leaks into an unrelated task",
              );
            } finally {
              await harness.runHooks("session_shutdown", {}, ctx);
              rmSync(cwd, { recursive: true, force: true });
            }
          }
        });

        // --- T9: the inspector must use the real terminal width, not a
        // hardcoded 76 columns (Problem 15) ---
        {
          const harness = createHarness({
            select: () => "Prüfnachweise",
          });
          auroraUi.default(harness.api);
          const ctx = harness.makeContext({ sessionId: "aurora-t9" });
          await harness.runHooks("session_start", {}, ctx);
          renderWidget(harness, ctx, 200, 40);

          const inspectCommand = harness.commands.get("inspect");
          harness.notifications.length = 0;
          await inspectCommand("", ctx);
          const notified = stripAnsi(
            harness.notifications.at(-1)?.message ?? "",
          );
          const widest = Math.max(
            0,
            ...notified.split("\n").map((line) => line.length),
          );
          assert(
            widest > 76,
            `the inspector uses more than the hardcoded 76 columns on a 200-column terminal (widest rendered line: ${widest})`,
          );
          await harness.runHooks("session_shutdown", {}, ctx);
        }

        // --- T10: dashboardMode "hidden" must not remove the only
        // indication that work is still happening (Problem 12) ---
        await withIsolatedAgentDir(async () => {
          const harness = createHarness();
          auroraUi.default(harness.api);
          const ctx = harness.makeContext({ sessionId: "aurora-t10" });
          await harness.runHooks("session_start", {}, ctx);
          await ctx.ui.submitSlashCommand("/dashboard hidden");
          await harness.runHooks("agent_start", {}, ctx);
          await harness.runHooks(
            "tool_execution_start",
            {
              toolCallId: "t10-tool",
              toolName: "bash",
              args: { command: "npm run build" },
            },
            ctx,
          );
          renderWidget(harness, ctx, 120, 30);
          assert(
            harness.workingVisibility.includes(true),
            "hidden dashboard mode falls back to Pi's native working indicator while work is live",
          );
          await harness.runHooks("session_shutdown", {}, ctx);
        });

        // --- T11: a needs_attention subagent must survive an extremely
        // tight row budget, not just a tight tool/subagent slot budget
        // (Problem 9 / Invariante 3) ---
        {
          const harness = createHarness();
          auroraUi.default(harness.api);
          const ctx = harness.makeContext({ sessionId: "aurora-t11" });
          await harness.runHooks("session_start", {}, ctx);
          await harness.runHooks("agent_start", {}, ctx);
          await harness.runHooks(
            "tool_execution_start",
            {
              toolCallId: "t11-tool",
              toolName: "read",
              args: { path: "a.ts" },
            },
            ctx,
          );
          harness.api.events.emit("subagent:async-started", {
            id: "t11-run",
            sessionId: ctx.sessionManager.getSessionId(),
            agents: ["investigator"],
          });
          harness.api.events.emit("subagent:control-event", {
            event: {
              type: "needs_attention",
              runId: "t11-run",
              agent: "investigator",
            },
          });
          // Standard layout (52x14) leaves only enough row budget for the
          // title, the live-status heading, and exactly one more line.
          const lines = renderWidget(harness, ctx, 52, 14);
          assert(
            lines.some(
              (line) =>
                line.includes("investigator") &&
                line.toLowerCase().includes("aufmerksamkeit"),
            ),
            "a needs_attention subagent is named even when the row budget only leaves room for a single extra line",
          );
          await harness.runHooks("session_shutdown", {}, ctx);
        }

        // --- T12: switching sessions must not leak session A's task/
        // verification projection into session B's inspector ---
        {
          let selectedLabel = "Prüfnachweise";
          const harness = createHarness({ select: () => selectedLabel });
          auroraUi.default(harness.api);

          const ctxA = harness.makeContext({ sessionId: "aurora-t12-a" });
          await harness.runHooks("session_start", {}, ctxA);
          const epochA = outgoingEpoch(harness, auroraState);
          emitPatch(harness, auroraState, epochA, {
            verification: {
              status: "checks_failed",
              declaredRequiredIds: ["typecheck"],
              requiredOutcomes: { typecheck: "failed" },
              blockingRecommendedIds: [],
            },
          });
          await harness.runHooks(
            "before_agent_start",
            { prompt: "Aufgabe A: Migration abschliessen" },
            ctxA,
          );
          renderWidget(harness, ctxA, 120, 30);

          // A new session_start on the same extension instance is exactly
          // how Pi signals a session switch; the extension keeps running.
          const ctxB = harness.makeContext({ sessionId: "aurora-t12-b" });
          await harness.runHooks("session_start", {}, ctxB);

          const inspectCommand = harness.commands.get("inspect");
          harness.notifications.length = 0;
          await inspectCommand("", ctxB);
          const notified = stripAnsi(
            harness.notifications.at(-1)?.message ?? "",
          );
          assert(
            !notified.includes("NOT_READY") && !notified.includes("typecheck"),
            "session B's inspector shows no verification evidence left over from session A",
          );

          const linesB = renderWidget(harness, ctxB, 120, 30);
          assert(
            !linesB.some((line) => line.includes("Aufgabe A")),
            "session B's dashboard does not show session A's task title",
          );
          await harness.runHooks("session_shutdown", {}, ctxB);
        }
      }
    });
  },
};
