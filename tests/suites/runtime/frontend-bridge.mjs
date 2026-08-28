// Phase 5: Die frontend-bridge macht Pi-spezifische Core-Zustände (Workflow,
// Task, Verification, Changes, Subagenten, Permissions) über die RPC-Grenze
// sichtbar. Diese Suite prüft den Transportpfad im Pi-Prozess selbst:
// Bus-Patches werden gemerged, gedrosselt als Custom-Session-Eintrag
// persistiert und tragen exakt die Felder des Frontend-Vertrags.
import { assert, eq } from "../../shared/assertions.mjs";
import { createHarness } from "../../shared/harness.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const frontendBridgeSections = {
  "frontend bridge core state transport": async (context) => {
    const { section, load } = context;

    await section("frontend bridge core state transport", async () => {
      const bridgeModule = await load("extensions/frontend-bridge/index.ts");
      const fp = await load("extensions/frontend-protocol/index.ts");
      const channels = fp.FRONTEND_STATE_CHANNELS;

      const harness = createHarness();
      bridgeModule.default(harness.api);
      const ctx = harness.makeContext({ cwd: process.cwd() });
      await harness.runHooks("session_start", {}, ctx);

      // Vor einem State-Request kennt die Bridge keine Epoch und darf
      // nichts persistieren (keine Spekulation, kein Rauschen).
      harness.api.events.emit(channels.patch, {
        type: "patch",
        sessionEpoch: "epoch-early",
        source: "plan-mode",
        patch: { workflow: { phase: "work", label: "Work" } },
      });
      await sleep(300);
      eq(
        harness.appended.filter((e) => e.customType === "frontend-bridge/state")
          .length,
        0,
        "ohne Epoch-Publish bleibt die Bridge stumm",
      );

      // Aurora öffnet die Epoch; danach muss die Bridge liefern.
      harness.api.events.emit(channels.request, {
        type: "request",
        requestId: "req-1:aurora-ui",
        sessionEpoch: "epoch-1",
        requester: "aurora-ui",
      });

      harness.api.events.emit(channels.patch, {
        type: "patch",
        sessionEpoch: "epoch-1",
        source: "plan-mode",
        patch: { workflow: { phase: "simple_plan", label: "Schnellplan" } },
      });
      harness.api.events.emit(channels.patch, {
        type: "patch",
        sessionEpoch: "epoch-1",
        source: "permissions",
        patch: { permissions: { level: "confirm-all", label: "Bestätigen" } },
      });
      harness.api.events.emit(channels.patch, {
        type: "patch",
        sessionEpoch: "epoch-1",
        source: "setup-core",
        patch: {
          verification: {
            status: "verified",
            declaredRequiredIds: ["verify"],
            requiredOutcomes: { verify: "success" },
            blockingRecommendedIds: [],
          },
        },
      });
      harness.api.events.emit(channels.patch, {
        type: "patch",
        sessionEpoch: "epoch-1",
        source: "diff-viewer",
        patch: {
          changes: {
            filesCount: 2,
            files: ["a.ts", "b.ts"],
            linesAdded: 5,
            linesRemoved: 1,
          },
        },
      });
      // Snapshot-Antworten werden ebenfalls übernommen.
      harness.api.events.emit(channels.snapshot, {
        type: "snapshot",
        requestId: "req-1:aurora-ui",
        sessionEpoch: "epoch-1",
        source: "lsp",
        state: { lsp: { state: "ready", detail: "2 Server" } },
      });

      // Die letzte Nutzereingabe speist den Task-Titel (Core-Signal,
      // niemals Chat-Heuristik).
      await harness.runHooks(
        "message_start",
        {
          message: {
            role: "user",
            content: [{ type: "text", text: "Bridge-Zustände prüfen" }],
          },
        },
        ctx,
      );

      // Subagenten kommen über die Paket-Events des Cores.
      harness.api.events.emit("subagent:async-started", {
        id: "run-1",
        agents: ["investigator"],
      });
      harness.api.events.emit("subagent:control-event", {
        event: { type: "needs_attention", runId: "run-1", agent: "investigator" },
      });

      await sleep(300);
      const entries = harness.appended.filter(
        (entry) => entry.customType === "frontend-bridge/state",
      );
      assert(entries.length > 0, "die Bridge persistiert einen State-Eintrag");
      const last = entries.at(-1);
      eq(last.data.v, fp.PROTOCOL_VERSION, "Eintrag trägt die Protokollversion");
      eq(last.data.sessionEpoch, "epoch-1", "Eintrag trägt die Epoch");
      eq(
        last.data.sessionId,
        ctx.sessionManager.getSessionId(),
        "Eintrag trägt die Core-Session-ID",
      );
      const state = last.data.state;
      eq(state.workflow.phase, "simple_plan", "workflow kommt aus dem Bus");
      eq(
        state.permissions.level,
        "confirm-all",
        "permissions kommen aus dem Bus",
      );
      eq(
        state.verification.status,
        "verified",
        "verification kommt aus dem Bus",
      );
      eq(state.changes.filesCount, 2, "changes kommen aus dem Bus");
      eq(state.lsp.state, "ready", "lsp kommt aus dem Snapshot");
      eq(
        state.task.title,
        "Bridge-Zustände prüfen",
        "task title kommt aus der letzten Nutzereingabe",
      );
      eq(state.subagents.length, 1, "ein Subagent ist gemeldet");
      eq(
        state.subagents[0].status,
        "needs_attention",
        "control-events heben den Subagenten hervor",
      );

      // Eine fremde Epoch darf den Zustand nicht verändern (R12).
      const countBefore = entries.length;
      harness.api.events.emit(channels.patch, {
        type: "patch",
        sessionEpoch: "epoch-fremd",
        source: "plan-mode",
        patch: { workflow: { phase: "work", label: "Work" } },
      });
      await sleep(300);
      const entriesAfter = harness.appended.filter(
        (entry) => entry.customType === "frontend-bridge/state",
      );
      eq(
        entriesAfter.length,
        countBefore,
        "fremde Epochen erzeugen keinen neuen Eintrag",
      );
      eq(
        entriesAfter.at(-1).data.state.workflow.phase,
        "simple_plan",
        "fremde Epochen verändern den Zustand nicht",
      );

      // Ein abgeschlossener Subagent verschwindet aus dem Zustand.
      harness.api.events.emit("subagent:async-complete", { id: "run-1" });
      await sleep(300);
      const finalEntries = harness.appended.filter(
        (entry) => entry.customType === "frontend-bridge/state",
      );
      eq(
        finalEntries.at(-1).data.state.subagents.length,
        0,
        "abgeschlossene Subagenten werden entfernt",
      );

      // Ein neuer Session-Start darf weder den zuletzt eingegebenen Prompt
      // noch einen alten, verzögerten Flush übernehmen.
      const nextCtx = harness.makeContext({
        cwd: process.cwd(),
        sessionId: "next-session",
      });
      await harness.runHooks("session_start", {}, nextCtx);
      harness.api.events.emit(channels.request, {
        type: "request",
        requestId: "req-2:aurora-ui",
        sessionEpoch: "epoch-2",
        requester: "aurora-ui",
      });
      harness.api.events.emit(channels.patch, {
        type: "patch",
        sessionEpoch: "epoch-2",
        source: "permissions",
        patch: { permissions: { level: "readonly", label: "Lesen" } },
      });
      await sleep(300);
      const resumedEntries = harness.appended.filter(
        (entry) => entry.customType === "frontend-bridge/state",
      );
      const resumed = resumedEntries.at(-1).data;
      eq(resumed.sessionId, "next-session", "neue Session-ID wird übernommen");
      eq(
        resumed.state.task.title,
        "Aktuelle Aufgabe",
        "neue Session erbt keinen alten Nutzertitel",
      );

      await harness.runHooks("session_shutdown", {}, nextCtx);
    });
  },
};
