// Contract-Tests für das Frontend-Protokoll (GUI-Arbeitsauftrag Phase 2):
// Versionierung, Command-Registry, Pflicht-State-Felder mit Core-Besitzern,
// Ereignisquellen, Shortcut-Mapping auf semantische Commands und der
// Compatibility-Layer zwischen dem Aurora-Zustandsbus und dem
// versionierten Protokollformat.
import { assert, eq } from "../../shared/assertions.mjs";

export const frontendProtocolSections = {
  "Frontend protocol contract v1": async (context) => {
    const { section, load, auroraState } = context;

    await section("Frontend protocol contract v1", async () => {
      const fp = await load("extensions/frontend-protocol/index.ts");
      assert(fp, "frontend-protocol module loads via jiti");

      // 1. Das Protokoll ist versioniert.
      assert(
        /^\d+\.\d+\.\d+$/.test(fp.PROTOCOL_VERSION),
        `PROTOCOL_VERSION is semver: ${fp.PROTOCOL_VERSION}`,
      );

      // 2. Alle im Arbeitsauftrag (Dokument 07) geforderten Commands
      //    existieren mit eindeutigen IDs und gültigen Targets.
      for (const id of fp.REQUIRED_COMMAND_IDS) {
        assert(
          Boolean(fp.COMMAND_REGISTRY[id]),
          `required command ${id} is registered`,
        );
      }
      const targetKinds = ["rpc", "slash", "bridge", "local", "tui"];
      for (const [id, def] of Object.entries(fp.COMMAND_REGISTRY)) {
        assert(
          targetKinds.includes(def.target.type),
          `${id}: target kind ${def.target.type} is known`,
        );
        if (def.target.type === "rpc") {
          assert(
            typeof def.target.op === "string" && def.target.op.length > 0,
            `${id}: rpc op is named`,
          );
        }
        if (def.target.type === "slash") {
          assert(
            def.target.name.startsWith("/"),
            `${id}: slash target starts with /`,
          );
        }
        if (def.target.type === "bridge") {
          assert(
            typeof def.target.reason === "string" &&
              def.target.reason.length > 10,
            `${id}: bridge gap documents its reason (R13)`,
          );
          assert(
            Number.isInteger(def.target.phase),
            `${id}: bridge names the closing phase`,
          );
        }
        if (def.target.type === "tui") {
          assert(
            typeof def.target.note === "string" && def.target.note.length > 5,
            `${id}: tui-only entry explains itself`,
          );
        }
      }

      // 3. RPC-Ops verweisen nur auf dokumentierte Runtime-Operationen.
      const documentedRpcOps = new Set([
        "get_state",
        "new_session",
        "switch_session",
        "fork",
        "clone",
        "set_model",
        "cycle_model",
        "get_available_models",
        "get_available_thinking_levels",
        "set_thinking_level",
        "cycle_thinking_level",
        "get_commands",
        "get_session_stats",
        "tool_execution_start",
        "tool_execution_end",
        "agent_start",
        "agent_settled",
      ]);
      for (const def of Object.values(fp.COMMAND_REGISTRY)) {
        if (def.target.type !== "rpc") continue;
        assert(
          documentedRpcOps.has(def.target.op),
          `command op ${def.target.op} is a documented runtime RPC operation`,
        );
      }

      // 4. State-Schema deckt die zwölf Pflichtfelder ab; Besitzer sind
      //    Core-seitig, niemals eine Präsentationsschicht.
      const requiredFields = [
        "session",
        "workflow",
        "task",
        "activity",
        "changes",
        "verification",
        "subagents",
        "model",
        "thinking",
        "permissions",
        "context",
        "lsp",
      ];
      for (const field of requiredFields) {
        assert(
          Boolean(fp.FRONTEND_STATE_FIELDS[field]),
          `state field ${field} has an owner`,
        );
      }
      for (const [field, meta] of Object.entries(fp.FRONTEND_STATE_FIELDS)) {
        assert(
          fp.STATE_FIELD_OWNERS.includes(meta.owner),
          `${field}: owner ${meta.owner} is in the allowed owner set`,
        );
        assert(
          !String(meta.owner).includes("aurora"),
          `${field}: owner is not a renderer layer`,
        );
        assert(
          ["rpc", "bus", "bus-events"].includes(meta.transport),
          `${field}: transport ${meta.transport} is known`,
        );
      }

      // 5. Kanalstabilität: Der Aurora-Legacy-Konstante ist exakt der
      //    neutrale Vertrag (gleiche Objektidentität, gleiche Namen).
      eq(
        auroraState.AURORA_UI_CHANNELS,
        fp.FRONTEND_STATE_CHANNELS,
        "Aurora legacy channels are the neutral contract channels",
      );

      // 6. Alle Pflichtereignisse aus dem Arbeitsauftrag existieren und
      //    haben mindestens eine Quelle bzw. eine dokumentierte Ableitung.
      const requiredEvents = [
        "state.snapshot",
        "state.patch",
        "tool.started",
        "tool.completed",
        "tool.failed",
        "agent.started",
        "agent.settled",
        "verification.changed",
        "session.changed",
      ];
      for (const event of requiredEvents) {
        assert(
          fp.PROTOCOL_EVENTS.includes(event),
          `protocol event ${event} is declared`,
        );
      }
      for (const event of fp.PROTOCOL_EVENTS) {
        const source = fp.EVENT_SOURCES[event];
        assert(Boolean(source), `event ${event} has a source entry`);
        const grounded =
          (source.rpc?.length ?? 0) +
          (source.bus?.length ?? 0) +
          (source.derivedFrom ? 1 : 0);
        assert(grounded > 0, `event ${event} is grounded in the core`);
        for (const op of source.rpc ?? []) {
          assert(
            documentedRpcOps.has(op),
            `event ${event} references documented rpc op ${op}`,
          );
        }
      }

      // 7. Shortcut-Mapping: Baseline-Paare aus der Phase-0-Erhebung
      //    bleiben stabil und zielen auf registrierte Commands.
      const expectedPairs = [
        ["shift+tab", "workflow.open"],
        ["super+m", "model.open"],
        ["super+d", "thinking.open"],
        ["super+q", "app.commandCenter"],
        ["super+i", "inspector.open"],
        ["super+y", "yolo.toggle"],
        ["super+s", "subagents.rolesModel"],
        ["super+r", "session.resume"],
        ["super+t", "thinking.cycle"],
        ["super+,", "model.cycle"],
        ["super+shift+y", "editor.yank"],
      ];
      const keyToCommand = Object.fromEntries(
        fp.SHORTCUT_COMMAND_MAP.map((m) => [m.keys, m.command]),
      );
      for (const [keys, command] of expectedPairs) {
        eq(keyToCommand[keys], command, `${keys} maps to ${command}`);
      }
      for (const mapping of fp.SHORTCUT_COMMAND_MAP) {
        assert(
          Boolean(fp.COMMAND_REGISTRY[mapping.command]),
          `${mapping.keys} targets registered command ${mapping.command}`,
        );
        assert(
          typeof mapping.portable === "boolean",
          `${mapping.keys}: portability is explicit`,
        );
      }

      // 8. Compatibility-Layer: Bus-Payloads formen sich ohne
      //    Feldverlust in Protokollereignisse um; Anfragen tragen die
      //    Protokollversion als Requester-Kennzeichnung.
      const patchEvent = {
        type: "patch",
        sessionEpoch: "epoch-1",
        source: "setup-core",
        patch: {
          verification: {
            status: "READY",
            declaredRequiredIds: [],
            requiredOutcomes: {},
            blockingRecommendedIds: [],
          },
        },
      };
      const protocolPatch = fp.auroraPatchToProtocolEvent(patchEvent);
      eq(protocolPatch.type, "state.patch");
      eq(protocolPatch.sessionEpoch, "epoch-1");
      eq(protocolPatch.source, "setup-core");
      eq(protocolPatch.fields.verification.status, "READY");

      const snapshotEvent = {
        type: "snapshot",
        requestId: "req-9",
        sessionEpoch: "epoch-2",
        source: "diff-viewer",
        state: { changes: { filesCount: 2 } },
      };
      const protocolSnapshot = fp.auroraSnapshotToProtocolEvent(snapshotEvent);
      eq(protocolSnapshot.type, "state.snapshot");
      eq(protocolSnapshot.requestId, "req-9");
      eq(protocolSnapshot.sessionEpoch, "epoch-2");
      eq(protocolSnapshot.fields.changes.filesCount, 2);

      const request = fp.protocolStateRequest("req-10", "epoch-3");
      eq(request.type, "request");
      eq(request.requestId, "req-10");
      eq(request.sessionEpoch, "epoch-3");
      eq(request.requester, "frontend-bridge/v1");

      // 9. Die Aurora-Legacy-Oberfläche bleibt vollständig erhalten:
      //    Publish-/Merge-Helfer und Guard-Funktionen arbeiten weiter.
      assert(
        typeof auroraState.publishAuroraUiPatch === "function",
        "publishAuroraUiPatch survives the contract extraction",
      );
      assert(
        typeof fp.mergeFrontendUiState === "function",
        "neutral merge is exported by frontend-protocol",
      );
      assert(
        typeof fp.isFrontendUiStateRequest === "function",
        "neutral request guard is exported by frontend-protocol",
      );
      assert(
        typeof auroraState.mergeAuroraUiState === "function",
        "mergeAuroraUiState survives the contract extraction",
      );
      assert(
        typeof auroraState.isAuroraUiStateRequest === "function",
        "isAuroraUiStateRequest survives the contract extraction",
      );
      assert(
        auroraState.AURORA_UI_CHANNELS.request === "aurora-ui/state/request",
        "channel names are unchanged for existing providers",
      );

      // 10. Phase-5-Pflichtfix: workflow.set läuft über den dokumentierten
      //    Direktsetzer /workflow-set; die Auswahl ist frontend-lokal.
      eq(
        fp.COMMAND_REGISTRY["workflow.set"].target.type,
        "slash",
        "workflow.set is executable via slash since phase 5",
      );
      eq(
        fp.COMMAND_REGISTRY["workflow.set"].target.name,
        "/workflow-set",
        "workflow.set targets /workflow-set",
      );
      eq(
        fp.COMMAND_REGISTRY["workflow.open"].target.type,
        "local",
        "workflow.open renders frontend-local since phase 5",
      );
      eq(
        fp.COMMAND_REGISTRY["permissions.set"].target.type,
        "slash",
        "permissions.set is executable via /permission <level>",
      );

      // 11. Divergenztest (Phase 5): Aurora und GUI-Bridge konsumieren
      //    denselben Merge-Pfad. Dieselbe Patch-Sequenz muss in beiden
      //    Konsumenten fachlich identische Felder erzeugen.
      const baseState = () => ({
        sessionEpoch: "epoch-9",
        workflow: { phase: "work", label: "Work" },
        permissions: {},
        lsp: {},
        model: {},
        activity: { kind: "idle" },
        changes: null,
        verification: null,
        task: { title: "Aktuelle Aufgabe", phaseLabel: "Bereit" },
        subagents: [],
      });
      const patchSequence = [
        { workflow: { phase: "detailed_plan", label: "Architekturplan" } },
        // A plan waiting for a decision, and a mid-turn switch that is merely
        // pending: both frontends must see the same thing, because both have to
        // offer the same three choices and must not present a pending switch as
        // an applied one.
        {
          workflow: {
            pending: "work",
            planReady: { hash: "abc123", mode: "detailed_plan", qualityOk: true },
          },
        },
        { permissions: { level: "confirm-all", label: "Bestätigen" } },
        {
          verification: {
            status: "verified",
            declaredRequiredIds: ["verify"],
            requiredOutcomes: { verify: "success" },
            blockingRecommendedIds: [],
          },
        },
        {
          changes: {
            filesCount: 1,
            files: ["a.ts"],
            linesAdded: 3,
            linesRemoved: 1,
          },
        },
        { activity: { kind: "tool" } },
        {
          subagents: [
            {
              agent: "investigator",
              role: "investigator",
              runId: "r1",
              status: "queued",
            },
          ],
        },
      ];
      const auroraSide = baseState();
      const guiSide = baseState();
      for (const patch of patchSequence) {
        auroraState.mergeAuroraUiState(auroraSide, patch);
        fp.mergeFrontendUiState(guiSide, patch);
      }
      eq(
        auroraSide.workflow,
        guiSide.workflow,
        "workflow state is identical across frontends",
      );
      eq(
        auroraSide.workflow.planReady?.hash,
        "abc123",
        "the plan readiness a frontend approves against survives the merge",
      );
      eq(
        auroraSide.workflow.pending,
        "work",
        "a deferred mode switch is carried as pending, not as the active phase",
      );
      eq(
        auroraSide.workflow.phase,
        "detailed_plan",
        "and the active phase stays the mode the running turn is under",
      );

      // 12. Die Planentscheidung braucht in jedem Frontend denselben Weg.
      for (const id of ["plan.decide", "plan.approve"]) {
        eq(
          fp.COMMAND_REGISTRY[id].target.type,
          "slash",
          `${id} is executable through the same slash command everywhere`,
        );
        assert(
          fp.REQUIRED_COMMAND_IDS.includes(id),
          `${id} is a required command, not an Aurora-only affordance`,
        );
      }
      eq(
        auroraSide.permissions,
        guiSide.permissions,
        "permissions state is identical across frontends",
      );
      eq(
        auroraSide.verification,
        guiSide.verification,
        "verification state is identical across frontends",
      );
      eq(
        auroraSide.changes,
        guiSide.changes,
        "changes state is identical across frontends",
      );
      eq(
        auroraSide.activity,
        guiSide.activity,
        "activity state is identical across frontends",
      );
      eq(
        auroraSide.subagents,
        guiSide.subagents,
        "subagent state is identical across frontends",
      );
    });
  },
};
