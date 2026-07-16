/**
 * Plan workflow extension.
 *
 * Workflow: /plan -> /work (review-plan optional, finish meist automatisch)
 */

import type {
  AgentMessage,
  ThinkingLevel,
} from "@earendil-works/pi-agent-core";
import {
  StringEnum,
  type AssistantMessage,
  type TextContent,
} from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";
import { relative } from "node:path";
import { Type } from "typebox";
import {
  applyDoneSteps,
  archiveDecisionBrief,
  archivePlanFile,
  DECISION_BRIEF_RELATIVE_PATH,
  DECISION_BUDGET_COMPLEX,
  DECISION_BUDGET_DEFAULT,
  ensurePlanMetadataHeader,
  ensurePlanDirectory,
  extractDecisionBriefBlock,
  extractDoneSteps,
  extractProgressBlock,
  extractTodoItems,
  getReviewOutcome,
  hashPlanContent,
  inferPlanType,
  INVALID_DECISION_BRIEF_RELATIVE_PATH,
  PLAN_RELATIVE_PATH,
  readDecisionBrief,
  readPlanFile,
  validateDecisionBriefStructure,
  validatePlanStructure,
  writeDecisionBriefAtomic,
  writeInvalidDecisionBriefAtomic,
  writePlanFileAtomic,
  type TodoItem,
} from "./utils.ts";
import {
  type WorkflowMode,
  type WorkflowPhase,
  ZENTUI_STATUS_KEYS,
  setTuiStatus,
  workflowStatusValue,
} from "../shared/workflow-status.ts";
import {
  AURORA_UI_CHANNELS,
  isAuroraUiStateRequest,
  publishAuroraUiPatch,
  publishAuroraUiSnapshot,
  type AuroraUiStatePatch,
  type AuroraWorkflowPhase,
} from "../aurora-ui/state.ts";
import { runMenu, type MenuEntry } from "../shared/menu-ui.ts";
import {
  buildControlCenterMenu,
  buildModelRoleMenu,
  type ControlCenterAction,
  type ModelRole,
} from "../shared/control-center-menu.ts";
import {
  CONTROL_CENTER_EVENTS,
  type ControlCenterSnapshot,
  type WorkflowThinkingDefaultEvent,
} from "../shared/control-center-events.ts";
import { SHORTCUTS } from "../shared/shortcuts.ts";
import {
  WORKFLOW_CAPABILITY_EVENTS,
  type WorkflowCapabilityRequest,
  type WorkflowCapabilityState,
} from "../shared/workflow-capabilities.ts";
import { loadSetupConfig } from "../setup-core/config.ts";
import {
  buildBriefOverwriteGuardMenu,
  buildDecisionHandoffMenu,
  buildOverwriteGuardMenu,
  buildPlanAssistantMenu,
  type DecisionHandoffAction,
  type OverwriteDecision,
  type PlanAssistantAction,
} from "./plan-menu.ts";
import {
  createWorkflowStateSnapshot,
  loadWorkflowState,
  removeWorkflowState,
  withWorkspaceLock,
  writeWorkflowStateAtomic,
  writeWorkflowStateAtomicCAS,
  type PlanProgressRecord,
  type PlanProgressStatus,
} from "./state.ts";

// Context markers: kept as constants so injection (below) and detection (in
// the "context" handler) can never drift apart, unlike two separately
// hand-typed copies of the same bracketed text.
const PLAN_MODE_MARKER = "[PLAN MODE ACTIVE]";
const PLAN_REVIEW_MARKER = "[PLAN REVIEW ACTIVE]";
const EXECUTING_PLAN_MARKER = "[EXECUTING PLAN]";
const DECISION_INTAKE_MARKER = "[DECISION INTAKE ACTIVE]";

// Gemeinsamer Subagenten-Hinweis für die Ausführungsphase: kept as a constant
// so the two injection sites (before_agent_start during "executing" and
// executePlan()) can't drift apart into two separately hand-typed copies.
const SUBAGENT_EXECUTING_REMINDER =
  "SUBAGENTEN:\nNutze das `subagent`-Tool bei Bedarf (siehe AGENTS.md → Subagenten-Delegation), z. B. für abgegrenzte Teilscopes oder Prüfungen nach Änderungen.";

const PLAN_PROGRESS_STATUSES = [
  "in_progress",
  "completed",
  "blocked",
] as const;

const PlanProgressParams = Type.Object({
  executionId: Type.String({
    minLength: 1,
    description: "Execution-ID aus dem aktuellen /work-Handoff",
  }),
  step: Type.Integer({
    minimum: 1,
    description: "1-basierte Todo-Nummer aus /plan-todos (T1 = 1)",
  }),
  status: StringEnum(PLAN_PROGRESS_STATUSES, {
    description:
      "in_progress für laufende Arbeit, completed nur nach erfolgreichem Nachweis, blocked für einen konkreten Blocker",
  }),
  evidence: Type.String({
    minLength: 1,
    maxLength: 1000,
    description:
      "Konkreter, kurzer Nachweis für den Status, z. B. Testresultat, betroffene Datei oder Blocker-Ursache",
  }),
});

// Persistenter Kontext für den „Einfachen Plan": dieselbe Plan-Datei wie im
// ausführlichen Modus, aber ohne lange Architektur-/Risiko-Blöcke.
const SIMPLE_PLAN_PROMPT = `[EINFACHER PLAN]
Erstelle einen schlichten, schnell einsetzbaren Plan für die aktuelle Aufgabe — geeignet für kleine bis mittlere Änderungen.

Vorgehen:
- Stelle höchstens wenige gezielte Rückfragen, und nur, wenn sie für einen umsetzbaren Plan wirklich nötig sind (nutze dazu ask_user).
- Verzichte auf ausführliche Architekturprüfung und lange Risiko-/Audit-Blöcke.
- Nutze bei Bedarf das \`subagent\`-Tool (siehe AGENTS.md → Subagenten-Delegation), aber nur wenn es den Schnellplan wirklich beschleunigt, nicht routinemäßig.
- Führe die Aufgabe nicht aus und ändere keine anderen Dateien.

Schreibe den finalen kurzen Plan nach ${PLAN_RELATIVE_PATH}.
Verwende mindestens diese gültige Struktur:

# Arbeitsplan: <Aufgabe>

## Auftrag
<Kurze Zielbeschreibung>

## Todos
- [ ] Konkreter Umsetzungsschritt
- [ ] Relevante Tests oder Checks ausführen

Pflicht sind die Abschnitte Auftrag und Todos mit mindestens einer Checkbox.
Stoppe nach dem Schreiben der Plan-Datei und bleibe knapp.`;

// Thinking-Level folgt im Auto-Modus dem Workflow-Modus: kompaktes Planen
// braucht kein Maximalbudget, Architekturanalysen schon. Manuell ausgewählte
// Werte bleiben bei echten Moduswechseln erhalten.
const MODE_THINKING: Record<WorkflowMode, ThinkingLevel> = {
  simple_plan: "medium",
  detailed_plan: "xhigh",
  work: "high",
};

const MODE_LABEL: Record<WorkflowMode, string> = {
  simple_plan: "Schnellplan",
  detailed_plan: "Architekturplan",
  work: "Work-Modus",
};

function auroraWorkflowPhase(phase: WorkflowPhase): AuroraWorkflowPhase {
  switch (phase) {
    case "idle":
      return "idle";
    case "draft":
    case "deciding":
    case "reviewing":
      return "drafting";
    case "reviewed":
      return "reviewed";
    case "executing":
      return "executing";
    case "paused":
      return "paused";
    case "blocked":
      return "blocked";
    case "ready":
      return "ready";
  }
}

interface PersistedWorkflowState {
  mode?: WorkflowMode;
  phase?: WorkflowPhase;
  // Legacy field retained only for state migration.
  planningActive?: boolean;
  reviewedHash?: string;
  planCreationMode?: "simple_plan" | "detailed_plan";
  // Legacy fields retained only for state migration.
  enabled?: boolean;
  executing?: boolean;
}

function isAssistantMessage(
  message: AgentMessage,
): message is AssistantMessage {
  return message.role === "assistant" && Array.isArray(message.content);
}

function getTextContent(message: AssistantMessage): string {
  return message.content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

function getLatestAssistantText(messages: AgentMessage[]): string {
  const latest = [...messages].reverse().find(isAssistantMessage);
  return latest ? getTextContent(latest) : "";
}

export default function planModeExtension(pi: ExtensionAPI): void {
  let mode: WorkflowMode = "work";
  let phase: WorkflowPhase = "idle";
  let reviewedHash: string | undefined;
  let planCreationMode: "simple_plan" | "detailed_plan" | undefined;
  let progressRecords: PlanProgressRecord[] = [];
  let auroraEpoch: string | undefined;
  let unsubscribeAurora: (() => void) | undefined;
  let latestCwd: string | undefined;
  let planModeEverUsed = false;
  let sessionEpoch = 0;
  let activeSessionId: string | undefined;
  let projectTrusted = false;
  let workflowRevision = 0;
  let currentPlanId: string | undefined;
  let decisionBriefHash: string | undefined;
  let sidecarCasReady = false;
  let activeRun:
    | {
        id: string;
        kind: "deciding" | "reviewing" | "executing";
        sessionId: string;
        startedAt: string;
        planHash?: string;
      }
    | undefined;
  let pendingPlan:
    | {
        mode: "simple_plan" | "detailed_plan";
        previousHash?: string;
      }
    | undefined;
  // Ob die Plan-Datei vor dem aktuellen Agent-Turn bereits existierte. Steuert,
  // dass das "Nächster Schritt"-Menü nur nach dem Turn erscheint, der den Plan
  // erzeugt hat — nicht nach jedem Verfeinerungs-Turn.
  let planExistedBeforeTurn = false;

  function startRun(
    kind: "deciding" | "reviewing" | "executing",
    ctx: ExtensionContext,
    planHash?: string,
  ): string {
    const id = randomUUID();
    activeRun = {
      id,
      kind,
      sessionId: ctx.sessionManager.getSessionId(),
      startedAt: new Date().toISOString(),
      ...(planHash ? { planHash } : {}),
    };
    return id;
  }

  function isCurrentRun(
    kind: "deciding" | "reviewing" | "executing",
    ctx: ExtensionContext,
  ): boolean {
    return (
      activeRun?.kind === kind &&
      activeRun.sessionId === ctx.sessionManager.getSessionId() &&
      activeSessionId === ctx.sessionManager.getSessionId()
    );
  }

  function workflowCapabilityState(): WorkflowCapabilityState {
    switch (phase) {
      case "deciding":
        return "deciding";
      case "reviewing":
        return "reviewing";
      case "executing":
        return "executing";
      case "paused":
        return "paused";
      case "blocked":
        return "blocked";
      case "ready":
        return "ready";
      case "draft":
      case "reviewed":
        return mode === "work" ? "work" : "planning";
      case "idle":
        return mode === "work" ? "work" : "planning";
    }
  }

  pi.events.on(WORKFLOW_CAPABILITY_EVENTS.request, (event) => {
    (event as WorkflowCapabilityRequest).respond({
      state: workflowCapabilityState(),
    });
  });

  pi.events.on(CONTROL_CENTER_EVENTS.workflowThinkingDefault, (event) => {
    (event as WorkflowThinkingDefaultEvent).respond({
      mode,
      defaultLevel: MODE_THINKING[mode],
    });
  });

  function readTodos(cwd: string): TodoItem[] {
    const content = readPlanFile(cwd);
    return content === undefined ? [] : extractTodoItems(content);
  }

  function effectivePlanType(
    content: string,
  ): "simple_plan" | "detailed_plan" | undefined {
    const inferred = inferPlanType(content);
    if (planCreationMode === "detailed_plan" || inferred === "detailed_plan") {
      return "detailed_plan";
    }
    if (planCreationMode === "simple_plan" || inferred === "simple_plan") {
      return "simple_plan";
    }
    return undefined;
  }

  function formatPlanTodoLines(todos: TodoItem[]): string[] {
    return todos.map((todo) => {
      const progress = progressRecords.find((record) => record.step === todo.step);
      const state = todo.completed
        ? "[x]"
        : progress?.status === "blocked"
          ? "[!]"
          : progress?.status === "in_progress"
            ? "[~]"
            : "[ ]";
      const evidence = progress?.evidence ? ` — ${progress.evidence}` : "";
      return `${state} T${todo.step}: ${todo.text}${evidence}`;
    });
  }

  function auroraWorkflowState(
    todos: TodoItem[],
  ): NonNullable<AuroraUiStatePatch["workflow"]> {
    const activeStep = progressRecords.find(
      (record) => record.status === "in_progress",
    )?.step;
    const currentTodo =
      (activeStep
        ? todos.find(
            (todo) => todo.step === activeStep && !todo.completed,
          )
        : undefined) ?? todos.find((todo) => !todo.completed);
    return {
      phase: auroraWorkflowPhase(phase),
      label: workflowStatusValue(phase, mode, todos),
      step: currentTodo
        ? `T${currentTodo.step}: ${currentTodo.text}`
        : undefined,
      completed: todos.filter((todo) => todo.completed).length,
      total: todos.length,
    };
  }

  function persistState(ctx: ExtensionContext): void {
    pi.appendEntry<PersistedWorkflowState>("plan-mode", {
      mode,
      phase,
      reviewedHash,
      planCreationMode,
    });

    try {
      const content = readPlanFile(ctx.cwd);
      if (content === undefined) {
        withWorkspaceLock(ctx.cwd, () => removeWorkflowState(ctx.cwd));
        progressRecords = [];
        workflowRevision = 0;
        currentPlanId = undefined;
        sidecarCasReady = false;
        return;
      }
      const snapshot = createWorkflowStateSnapshot(content, {
        mode,
        phase,
        revision: Math.max(1, workflowRevision + 1),
        planId: currentPlanId,
        planType: planCreationMode,
        reviewedHash,
        planCreationMode,
        decisionBriefHash,
        execution:
          phase === "executing" && activeRun?.kind === "executing" && activeRun.planHash
            ? {
                executionId: activeRun.id,
                startedAt: activeRun.startedAt,
                expectedPlanHash: activeRun.planHash,
                sessionId: activeRun.sessionId,
              }
            : undefined,
        progress: progressRecords,
      });
      let written = snapshot;
      if (sidecarCasReady) {
        written = writeWorkflowStateAtomicCAS(ctx.cwd, snapshot, {
          revision: workflowRevision,
          planHash: snapshot.planHash,
        });
      } else {
        withWorkspaceLock(ctx.cwd, () =>
          writeWorkflowStateAtomic(ctx.cwd, snapshot),
        );
      }
      progressRecords = written.progress;
      workflowRevision = written.revision;
      currentPlanId = written.planId;
      decisionBriefHash = written.decisionBriefHash;
      sidecarCasReady = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(
        `Workflow-Sidecar konnte nicht gespeichert werden: ${message}`,
        "warning",
      );
    }
  }

  function preparePlan(ctx: ExtensionContext): boolean {
    try {
      ensurePlanDirectory(ctx.cwd);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(
        `Plan-Modus konnte nicht aktiviert werden: ${message}`,
        "error",
      );
      return false;
    }

    planModeEverUsed = true;
    return true;
  }

  function updateStatus(ctx: ExtensionContext): void {
    latestCwd = ctx.cwd;
    let todos: TodoItem[] = [];
    try {
      todos = readTodos(ctx.cwd);
    } catch {
      // A transient filesystem error must not hide the current workflow mode.
    }
    const workflow = auroraWorkflowState(todos);
    const label = workflow.label ?? workflowStatusValue(phase, mode, todos);
    setTuiStatus(ctx, ZENTUI_STATUS_KEYS.workflow, label);
    if (auroraEpoch) {
      publishAuroraUiPatch(pi, auroraEpoch, "plan-workflow", {
        workflow,
      });
    }
  }

  function subscribeAuroraProvider(): void {
    unsubscribeAurora?.();
    unsubscribeAurora = pi.events.on(AURORA_UI_CHANNELS.request, (value) => {
      if (!isAuroraUiStateRequest(value)) return;
      auroraEpoch = value.sessionEpoch;
      let todos: TodoItem[] = [];
      try {
        // A request can arrive outside a Pi hook, so use the latest cwd captured
        // by the provider rather than reaching into UI-owned state.
        todos = latestCwd ? readTodos(latestCwd) : [];
      } catch {
        todos = [];
      }
      publishAuroraUiSnapshot(pi, value, "plan-workflow", {
        workflow: auroraWorkflowState(todos),
      });
    });
  }

  function invalidateReview(): void {
    reviewedHash = undefined;
    if (phase === "reviewed" || phase === "ready") phase = "draft";
  }

  function normalizeInterruptedPhase(ctx: ExtensionContext): void {
    if (phase !== "executing" && phase !== "reviewing" && phase !== "deciding")
      return;
    if (phase === "deciding") {
      // Ein unterbrochener Klär-Turn wird nicht als „deciding" fortgesetzt;
      // /decide kann erneut gestartet werden.
      let planExists = false;
      try {
        planExists = readPlanFile(ctx.cwd) !== undefined;
      } catch {
        planExists = false;
      }
      phase = planExists ? "draft" : "idle";
      reviewedHash = undefined;
      return;
    }
    try {
      const content = readPlanFile(ctx.cwd);
      if (content === undefined) {
        phase = "idle";
        reviewedHash = undefined;
      } else if (reviewedHash && hashPlanContent(content) === reviewedHash) {
        phase = "reviewed";
      } else {
        phase = "draft";
      }
    } catch {
      phase = "idle";
      reviewedHash = undefined;
    }
  }

  // Bricht einen laufenden Agent-Turn nur nach expliziter Bestätigung ab.
  // Idle-Kontexte liefern sofort true; ohne TUI wird die Aktion konservativ
  // abgelehnt statt still abzubrechen.
  async function confirmAbortActiveTurn(
    ctx: ExtensionContext,
  ): Promise<boolean> {
    if (ctx.isIdle()) return true;
    if (!ctx.hasUI || ctx.mode !== "tui") {
      ctx.ui.notify(
        "Ein Agent-Turn läuft; die Aktion würde ihn abbrechen und benötigt dafür den TUI-Modus.",
        "warning",
      );
      return false;
    }
    const confirmed = await ctx.ui.confirm(
      "Laufenden Agent-Turn abbrechen?",
      "Die gewählte Aktion stoppt den aktiven Turn und normalisiert den Workflow-Zustand.",
    );
    if (!confirmed) {
      ctx.ui.notify(
        "Aktion abgebrochen; der laufende Turn wird fortgesetzt.",
        "info",
      );
      return false;
    }
    ctx.abort();
    const maybeCommandCtx = ctx as Partial<ExtensionCommandContext>;
    if (typeof maybeCommandCtx.waitForIdle === "function") {
      await maybeCommandCtx.waitForIdle();
      return true;
    }
    ctx.ui.notify(
      "Der laufende Turn wurde abgebrochen. Wiederhole die Aktion, sobald der Agent vollständig beendet ist.",
      "info",
    );
    return false;
  }

  async function setWorkflowMode(
    target: WorkflowMode,
    ctx: ExtensionContext,
    options: { force?: boolean; skipAbort?: boolean } = {},
  ): Promise<boolean> {
    // Same-Mode-Auswahl im Idle ist ein No-op: ein versehentliches
    // Shift+Tab+Enter darf weder abbrechen noch neu initialisieren.
    if (!options.force && target === mode && ctx.isIdle()) {
      ctx.ui.notify(`${MODE_LABEL[target]} ist bereits aktiv.`, "info");
      return true;
    }
    if (!options.skipAbort && !(await confirmAbortActiveTurn(ctx))) return false;
    normalizeInterruptedPhase(ctx);

    if (target !== "work") {
      if (!preparePlan(ctx)) return false;
      invalidateReview();
      phase = "draft";
    } else if (
      phase !== "executing" &&
      phase !== "paused" &&
      phase !== "blocked" &&
      phase !== "ready"
    ) {
      let planExists = false;
      try {
        planExists = readPlanFile(ctx.cwd) !== undefined;
      } catch {
        // Preserve fail-closed error handling in the command that requested
        // the transition. A plain Work selection may still expose a stored
        // plan, but never claims that it is executing.
      }
      phase = planExists ? "draft" : "idle";
    }

    const modeChanged = target !== mode;
    mode = target;
    let thinkingMode: "auto" | "manual" = "auto";
    pi.events.emit(CONTROL_CENTER_EVENTS.snapshot, {
      respond: (snapshot: ControlCenterSnapshot) => {
        thinkingMode = snapshot.thinkingMode;
      },
    });
    if (modeChanged && thinkingMode === "auto") {
      pi.setThinkingLevel(MODE_THINKING[target]);
    }
    updateStatus(ctx);
    persistState(ctx);
    ctx.ui.notify(
      modeChanged
        ? `${MODE_LABEL[target]} aktiv. Thinking: ${thinkingMode === "auto" ? `${MODE_THINKING[target]} (Auto)` : "manueller Wert bleibt erhalten"}.`
        : `${MODE_LABEL[target]} aktiv.`,
      "info",
    );
    return true;
  }

  // /plan ist ein zustandsbewusster Plan-Assistent. Er erkennt, ob bereits
  // eine Plan-Datei existiert und ob alle Todos erledigt sind, und bietet
  // passend dazu Aktionen über die gemeinsame runMenu-UI an. Ohne TUI wird
  // konservativ verfahren: ohne Plan -> Architekturplan, mit Plan -> kein
  // Überschreiben, sondern Hinweis.
  async function routePlan(ctx: ExtensionContext): Promise<void> {
    if (!ctx.hasUI || ctx.mode !== "tui") {
      let planExists = false;
      try {
        planExists = readPlanFile(ctx.cwd) !== undefined;
      } catch {
        planExists = false;
      }
      if (!planExists) {
        await setWorkflowMode("detailed_plan", ctx);
      } else {
        ctx.ui.notify(
          `${PLAN_RELATIVE_PATH} existiert bereits. /plan benötigt den TUI-Modus, um den bestehenden Plan zu schützen.`,
          "warning",
        );
      }
      return;
    }

    let planExists = false;
    let allTodosComplete = false;
    try {
      const content = readPlanFile(ctx.cwd);
      planExists = content !== undefined;
      if (content !== undefined) {
        const todos = extractTodoItems(content);
        allTodosComplete =
          todos.length > 0 && todos.every((todo) => todo.completed);
      }
    } catch {
      planExists = false;
    }

    // Aktive Review/Execution sind keine harte Sperre; nur ein Hinweis.
    // Eingriffe in einen laufenden Turn regeln setWorkflowMode /
    // normalizeInterruptedPhase bzw. executePlan/reviewPlan selbst.
    if (phase === "reviewing") {
      ctx.ui.notify(
        "Ein Review läuft gerade. Du kannst dennoch eine Aktion wählen.",
        "info",
      );
    } else if (phase === "executing") {
      ctx.ui.notify(
        "Ein Plan wird gerade ausgeführt. Du kannst dennoch eine Aktion wählen.",
        "info",
      );
    }

    const title = planExists
      ? allTodosComplete
        ? "Plan-Assistent — Plan abgeschlossen"
        : "Plan-Assistent"
      : "Plan-Assistent — kein Plan vorhanden";

    const action = await runMenu<PlanAssistantAction>(
      ctx,
      title,
      buildPlanAssistantMenu({ planExists, allTodosComplete }),
      {
        fallbackPrompt: "Plan-Aktion wählen",
        nonInteractiveHint:
          "Plan-Assistent benötigt den TUI-Modus. Nutze /plan-todos oder /finish direkt.",
      },
    );
    if (!action || action.kind === "cancel") return;
    await dispatchPlanAssistantAction(action, ctx);
  }

  function showPlanTodos(ctx: ExtensionContext): void {
    try {
      const todos = readTodos(ctx.cwd);
      if (todos.length === 0) {
        ctx.ui.notify(
          [
            "KEIN AKTIVER PLAN-FORTSCHRITT",
            "",
            `Keine Todos in ${PLAN_RELATIVE_PATH} gefunden.`,
            "",
            "Nächster Schritt",
            "/plan starten oder bestehenden Plan prüfen.",
          ].join("\n"),
          "info",
        );
        return;
      }
      ctx.ui.notify(formatPlanTodoLines(todos).join("\n"), "info");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(
        `Plan-Datei konnte nicht gelesen werden: ${message}`,
        "error",
      );
    }
  }

  // Schützt eine bestehende Plan-Datei davor, durch einen neuen Plan still
  // überschrieben zu werden. Gibt true zurück, wenn ein neuer Plan erstellt
  // werden darf (archiviert oder bewusst überschrieben), sonst false.
  async function guardNewPlan(ctx: ExtensionContext): Promise<boolean> {
    let planExists = false;
    try {
      planExists = readPlanFile(ctx.cwd) !== undefined;
    } catch {
      planExists = false;
    }
    if (!planExists) return true;

    const decision = await runMenu<OverwriteDecision>(
      ctx,
      "Bestehenden Plan schützen",
      buildOverwriteGuardMenu(),
      {
        fallbackPrompt: "Bestehenden Plan behandeln",
        nonInteractiveHint:
          "Bestehender Plan würde überschrieben werden — Abbruch zum Schutz.",
      },
    );

    if (!decision || decision === "cancel") {
      ctx.ui.notify(
        "Neuer Plan abgebrochen; bestehende Datei bleibt erhalten.",
        "info",
      );
      return false;
    }

    if (decision === "archive-first") {
      try {
        const archivePath = archivePlanFile(ctx.cwd, "incomplete");
        reviewedHash = undefined;
        ctx.ui.notify(
          `Bisheriger Plan archiviert: ${relative(ctx.cwd, archivePath)}`,
          "info",
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(
          `Archivierung fehlgeschlagen; neuer Plan abgebrochen: ${message}`,
          "error",
        );
        return false;
      }
    }
    return true;
  }

  async function beginNewPlan(
    targetMode: "simple_plan" | "detailed_plan",
    ctx: ExtensionContext,
    options: { attachDecisionBrief?: boolean } = {},
  ): Promise<void> {
    // Never archive, overwrite or clear progress while an old turn can still
    // write to the active plan. This ordering is the data-loss boundary.
    if (!(await confirmAbortActiveTurn(ctx))) return;
    normalizeInterruptedPhase(ctx);

    let previousHash: string | undefined;
    try {
      const previous = readPlanFile(ctx.cwd);
      previousHash = previous === undefined ? undefined : hashPlanContent(previous);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`Bestehender Plan ist nicht sicher lesbar: ${message}`, "error");
      return;
    }

    if (!(await guardNewPlan(ctx))) return;
    if (options.attachDecisionBrief) {
      try {
        const brief = readDecisionBrief(ctx.cwd);
        decisionBriefHash = brief ? hashPlanContent(brief) : undefined;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Decision Brief ist nicht sicher lesbar: ${message}`, "error");
        return;
      }
    } else {
      decisionBriefHash = undefined;
    }
    pendingPlan = { mode: targetMode, previousHash };
    if (
      !(await setWorkflowMode(targetMode, ctx, {
        force: true,
        skipAbort: true,
      }))
    ) {
      pendingPlan = undefined;
    }
  }

  async function dispatchPlanAssistantAction(
    action: PlanAssistantAction,
    ctx: ExtensionContext,
  ): Promise<void> {
    switch (action.kind) {
      case "clarify": {
        await runDecisionIntake(ctx);
        return;
      }
      case "new-plan": {
        await beginNewPlan(action.mode, ctx);
        return;
      }
      case "continue-plan": {
        const targetMode: WorkflowMode =
          mode === "simple_plan" || mode === "detailed_plan"
            ? mode
            : "detailed_plan";
        await setWorkflowMode(targetMode, ctx);
        return;
      }
      case "review":
        await reviewPlan(ctx);
        return;
      case "execute":
        await executePlan(ctx);
        return;
      case "show-todos":
        showPlanTodos(ctx);
        return;
      case "archive":
        await runFinish(ctx);
        return;
      case "cancel":
        return;
    }
  }

  // /finish benötigt ein ExtensionCommandContext (waitForIdle). Aufrufer ohne
  // Command-Context (z. B. Shortcuts) erhalten einen Hinweis statt eines
  // Absturzes. Genau dieses Fallback prüft der plan-action Test.
  async function runFinish(ctx: ExtensionContext): Promise<void> {
    const maybeCommandCtx = ctx as Partial<ExtensionCommandContext>;
    if (typeof maybeCommandCtx.waitForIdle === "function") {
      await finishPlan(ctx as ExtensionCommandContext);
    } else {
      ctx.ui.notify("Nutze /finish, um den Plan abzuschließen.", "info");
    }
  }

  // Nach erfolgreicher Plan-Erstellung angeboten: kleines, nicht-blockierendes
  // Aktionsmenü. Esc / „Im Planmodus bleiben" ändern nichts; es wird niemals
  // automatisch ausgeführt. Wird nur im TUI und im Idle-Zustand gezeigt.
  async function offerPostPlanActions(ctx: ExtensionContext): Promise<void> {
    if (!ctx.hasUI || ctx.mode !== "tui") return;
    if (typeof ctx.isIdle === "function" && !ctx.isIdle()) return;

    type PostAction = "execute" | "review" | "show-todos" | "stay";
    const entries: MenuEntry<PostAction>[] = [
      {
        id: "post-work",
        label: "/work starten",
        description: "Plan-Datei sofort ausführen",
        value: "execute",
      },
      {
        id: "post-review",
        label: "/review-plan ausführen",
        description: "Optionalen Deep-Review des Plans starten",
        value: "review",
      },
      {
        id: "post-todos",
        label: "Todos anzeigen",
        description: "Plan-Fortschritt anzeigen",
        value: "show-todos",
      },
      {
        id: "post-stay",
        label: "Im Planmodus bleiben",
        description: "Keine weitere Aktion; Plan steht zum Verfeinern bereit",
        value: "stay",
      },
    ];

    let selected: PostAction | undefined;
    try {
      selected = await runMenu<PostAction>(ctx, "Nächster Schritt", entries, {
        fallbackPrompt: "Nächsten Schritt wählen",
        nonInteractiveHint:
          "Plan gespeichert. Nutze /work zum Ausführen oder /review-plan für einen Deep-Review.",
      });
    } catch {
      return;
    }

    if (!selected || selected === "stay") return;
    if (selected === "execute") await executePlan(ctx);
    else if (selected === "review") await reviewPlan(ctx);
    else if (selected === "show-todos") showPlanTodos(ctx);
  }

  // Bereitet den Klär-Modus vor (phase=deciding): TUI-Check, Abbruch-Guard,
  // Normalisierung, Schutz eines bestehenden Decision Brief und
  // Verzeichnisanlage. Liefert true, sobald der Klär-Modus aktiv ist — ohne
  // selbst einen Turn zu triggern. false bei Abbruch/Abwahl/Fehler.
  // Der eigentliche Intake-Prompt wird bewusst NICHT hier gesendet: Der Aufrufer
  // entscheidet, ob der Turn sofort (runDecisionIntake) oder erst bei der
  // nächsten Nutzernachricht (Modusmenü via before_agent_start) startet.
  async function enterDecisionMode(ctx: ExtensionContext): Promise<boolean> {
    if (!ctx.hasUI || ctx.mode !== "tui") {
      ctx.ui.notify(
        "Decision-Intake benötigt den TUI-Modus (ask_user ist interaktiv nur dort verfügbar).",
        "warning",
      );
      return false;
    }
    if (!(await confirmAbortActiveTurn(ctx))) return false;
    normalizeInterruptedPhase(ctx);

    // Bestehendes Decision Brief vor stillem Überschreiben schützen.
    let briefExists = false;
    try {
      briefExists = readDecisionBrief(ctx.cwd) !== undefined;
    } catch {
      briefExists = false;
    }
    if (briefExists) {
      const decision = await runMenu<OverwriteDecision>(
        ctx,
        "Bestehendes Decision Brief schützen",
        buildBriefOverwriteGuardMenu(),
        {
          fallbackPrompt: "Bestehendes Decision Brief behandeln",
          nonInteractiveHint:
            "Bestehendes Decision Brief würde überschrieben werden — Abbruch zum Schutz.",
        },
      );
      if (!decision || decision === "cancel") {
        ctx.ui.notify(
          "Decision-Intake abgebrochen; bestehendes Decision Brief bleibt erhalten.",
          "info",
        );
        return false;
      }
      if (decision === "archive-first") {
        try {
          const archivePath = archiveDecisionBrief(ctx.cwd);
          ctx.ui.notify(
            `Bisheriges Decision Brief archiviert: ${relative(ctx.cwd, archivePath)}`,
            "info",
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          ctx.ui.notify(
            `Archivierung fehlgeschlagen; Intake abgebrochen: ${message}`,
            "error",
          );
          return false;
        }
      }
    }

    try {
      ensurePlanDirectory(ctx.cwd);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(
        `Decision-Intake konnte nicht gestartet werden: ${message}`,
        "error",
      );
      return false;
    }

    phase = "deciding";
    reviewedHash = undefined;
    startRun("deciding", ctx);
    updateStatus(ctx);
    persistState(ctx);
    return true;
  }

  // Decision-Intake: vorgeschalteter Klär-Turn. Klärt über ask_user echte
  // Entscheidungen und endet mit einem [DECISION-BRIEF]-Block. Startet keine
  // Umsetzung und wechselt nicht nach /work. Startet den Intake SOFORT
  // (triggerTurn) — genutzt von /decide und der /plan-Aktion (clarify).
  async function runDecisionIntake(ctx: ExtensionContext): Promise<void> {
    if (!(await enterDecisionMode(ctx))) return;

    pi.sendMessage(
      {
        customType: "plan-decision-request",
        content: `${DECISION_INTAKE_MARKER}
Starte den Decision-Intake für die anstehende Aufgabe. Kläre über ask_user die
wesentlichen Entscheidungen (je 2–4 Optionen mit Bedeutung + Empfehlung), wie im
Kontext beschrieben, und schließe mit genau einem [DECISION-BRIEF]-Block ab.
Starte keine Umsetzung und wechsle nicht nach /work.`,
        display: true,
      },
      { triggerTurn: true },
    );
  }

  // Shift+Tab-Eintrag „Optionen klären": wechselt nur still in den Klär-Modus,
  // ohne sofort einen Intake-Turn zu starten — analog zu den anderen Plan-Modi.
  // Der Intake-Kontext wird bei der nächsten Nutzernachricht über den
  // before_agent_start-Handler (phase=deciding) injiziert.
  async function enterDecisionModeFromMenu(
    ctx: ExtensionContext,
  ): Promise<void> {
    if (phase === "deciding" && ctx.isIdle()) {
      ctx.ui.notify(
        "Optionen klären ist bereits aktiv – die nächste Nachricht startet den Intake.",
        "info",
      );
      return;
    }
    if (!(await enterDecisionMode(ctx))) return;
    ctx.ui.notify(
      "Optionen klären aktiv – die nächste Nachricht startet den Intake.",
      "info",
    );
  }

  // Wertet das Ende eines Decision-Turn aus: findet die Extension einen
  // [DECISION-BRIEF]-Block in der Antwort, schreibt sie ihn atomar nach
  // decision-brief.md (die Extension schreibt selbst, damit der Turn auf jeder
  // Permission-Stufe läuft). Ohne Block wird konservativ nichts gespeichert.
  async function handleDecisionTurnEnd(
    event: { messages: AgentMessage[] },
    ctx: ExtensionContext,
  ): Promise<void> {
    if (!isCurrentRun("deciding", ctx)) return;
    const block = extractDecisionBriefBlock(
      getLatestAssistantText(event.messages),
    );

    let planExists = false;
    try {
      planExists = readPlanFile(ctx.cwd) !== undefined;
    } catch {
      planExists = false;
    }

    const resetPhase = () => {
      phase = planExists ? "draft" : "idle";
      reviewedHash = undefined;
      activeRun = undefined;
      updateStatus(ctx);
      persistState(ctx);
    };

    if (!block) {
      resetPhase();
      ctx.ui.notify(
        "Kein Decision-Brief-Block erkannt; nichts gespeichert. Nutze /decide für einen neuen Versuch.",
        "warning",
      );
      return;
    }

    const structureErrors = validateDecisionBriefStructure(block);
    if (structureErrors.length > 0) {
      try {
        writeInvalidDecisionBriefAtomic(ctx.cwd, block);
      } catch {
        // Debug-Kopie ist optional — Fehler hier nicht nach oben weiterleiten.
      }
      resetPhase();
      ctx.ui.notify(
        `Decision Brief ungültig – nicht gespeichert:\n${structureErrors.join("\n")}\nKopie abgelegt unter ${INVALID_DECISION_BRIEF_RELATIVE_PATH}. Nutze /decide für einen neuen Versuch.`,
        "error",
      );
      return;
    }

    try {
      writeDecisionBriefAtomic(ctx.cwd, block);
      ctx.ui.notify(
        `Decision Brief gespeichert → ${DECISION_BRIEF_RELATIVE_PATH}`,
        "info",
      );
      resetPhase();
      await offerDecisionHandoff(ctx);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(
        `Decision Brief konnte nicht gespeichert werden: ${message}`,
        "error",
      );
      resetPhase();
    }
  }

  // Nicht-blockierendes Handoff-Menü nach einem geschriebenen Decision Brief.
  // Schnell-/Architekturplan aktivieren nur den Modus (der finale Plan bleibt
  // bei current-plan.md); nichts wird automatisch ausgeführt oder nach /work
  // gewechselt.
  async function offerDecisionHandoff(ctx: ExtensionContext): Promise<void> {
    if (!ctx.hasUI || ctx.mode !== "tui") return;
    if (typeof ctx.isIdle === "function" && !ctx.isIdle()) return;

    const action = await runMenu<DecisionHandoffAction>(
      ctx,
      "Decision Brief — nächster Schritt",
      buildDecisionHandoffMenu(),
      {
        fallbackPrompt: "Nächsten Schritt wählen",
        nonInteractiveHint:
          "Decision Brief gespeichert. Nutze /plan für Schnell-/Architekturplan.",
      },
    );
    if (!action || action === "cancel") return;
    if (action === "save-only") {
      ctx.ui.notify(
        `Decision Brief gespeichert → ${DECISION_BRIEF_RELATIVE_PATH}`,
        "info",
      );
      return;
    }

    // quick / detailed → Plan-Modus aktivieren; bestehenden Plan schützen.
    const targetMode = action === "quick" ? "simple_plan" : "detailed_plan";
    await beginNewPlan(targetMode, ctx, { attachDecisionBrief: true });
    if (mode !== targetMode) return;
    ctx.ui.notify(
      `${targetMode === "simple_plan" ? "Schnellplan" : "Architekturplan"} aktiv. Das Decision Brief wird als Kontext genutzt — beschreibe jetzt deine Aufgabe.`,
      "info",
    );
  }

  function configuredModelRole(
    current: { provider?: string; id?: string } | undefined,
    models: Record<ModelRole, string>,
  ): ModelRole | undefined {
    if (!current?.provider || !current.id) return undefined;
    return (["fast", "primary", "deep"] as const).find(
      (role) => models[role] === `${current.provider}/${current.id}`,
    );
  }

  function splitModelReference(value: string): [string, string] | undefined {
    const separator = value.indexOf("/");
    if (separator <= 0 || separator === value.length - 1) return undefined;
    return [value.slice(0, separator), value.slice(separator + 1)];
  }

  async function openModelRoles(ctx: ExtensionContext): Promise<void> {
    const models = loadSetupConfig(ctx.cwd, ctx.isProjectTrusted()).config.models;
    const selected = await runMenu(
      ctx,
      "Modellrollen",
      buildModelRoleMenu({
        models,
        activeRole: configuredModelRole(ctx.model, models),
      }),
      { fallbackPrompt: "Modellrolle wählen" },
    );
    if (!selected) return;
    if (!ctx.isIdle()) {
      ctx.ui.notify(
        "Modellwechsel ist nur möglich, wenn kein Agent-Turn läuft.",
        "warning",
      );
      return;
    }
    const reference = splitModelReference(models[selected]);
    if (!reference) {
      ctx.ui.notify(`Modellrolle ${selected} ist ungültig konfiguriert.`, "error");
      return;
    }
    const [provider, id] = reference;
    const target = ctx.modelRegistry.find(provider, id);
    if (!target) {
      ctx.ui.notify(
        `Modell für ${selected} ist nicht verfügbar (${models[selected]}). Prüfe Provider und Credentials.`,
        "error",
      );
      return;
    }
    try {
      await pi.setModel(target);
      ctx.ui.notify(`${selected === "fast" ? "Fast" : selected === "primary" ? "Primary" : "Deep"}: ${models[selected]} aktiv.`, "info");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(
        `Modell für ${selected} konnte nicht aktiviert werden (${models[selected]}): ${message}`,
        "error",
      );
    }
  }

  async function openControlCenter(ctx: ExtensionContext): Promise<void> {
    let snapshot:
      | { permissionLabel: string; thinkingMode: "auto" | "manual"; thinkingLevel: ThinkingLevel }
      | undefined;
    pi.events.emit(CONTROL_CENTER_EVENTS.snapshot, {
      respond: (value: ControlCenterSnapshot) => {
        snapshot = value;
      },
    });
    const thinking = snapshot
      ? `${snapshot.thinkingMode === "auto" ? "Auto" : "Manuell"} (${snapshot.thinkingLevel})`
      : "Auto";
    const selected = await runMenu<ControlCenterAction>(
      ctx,
      "Control Center",
      buildControlCenterMenu({
        mode,
        deciding: phase === "deciding",
        permissionLabel: snapshot?.permissionLabel ?? "nicht verfügbar",
        thinkingLabel: thinking,
      }),
      { nonInteractiveHint: "Control Center benötigt den TUI-Modus." },
    );
    if (!selected) return;
    if (selected === "decide") {
      await enterDecisionModeFromMenu(ctx);
      return;
    }
    if (selected === "simple_plan" || selected === "detailed_plan" || selected === "work") {
      await setWorkflowMode(selected, ctx);
      return;
    }
    if (selected === "model-roles") {
      await openModelRoles(ctx);
      return;
    }
    if (selected === "thinking") {
      pi.events.emit(CONTROL_CENTER_EVENTS.openThinking, { ctx });
      return;
    }
    if (selected === "permissions") {
      pi.events.emit(CONTROL_CENTER_EVENTS.openPermissions, { ctx });
      return;
    }
    pi.events.emit(CONTROL_CENTER_EVENTS.openDiagnostics, { ctx });
  }

  pi.registerFlag("plan", {
    description: "Start in detailed plan mode (permissions unchanged)",
    type: "boolean",
    default: false,
  });

  pi.registerCommand("plan", {
    description: "Plan-Assistent öffnen (zustandsabhängig)",
    handler: async (_args, ctx) => {
      await routePlan(ctx);
    },
  });

  pi.registerCommand("plan-todos", {
    description: "Todos aus der aktuellen Plan-Datei anzeigen",
    handler: async (_args, ctx) => {
      showPlanTodos(ctx);
    },
  });

  pi.registerCommand("decide", {
    description: "Decision-Intake starten (Optionen klären → Decision Brief)",
    handler: async (_args, ctx) => {
      await runDecisionIntake(ctx);
    },
  });

  pi.registerShortcut(SHORTCUTS.planAssistant.keys, {
    description: SHORTCUTS.planAssistant.description,
    handler: async (ctx) => {
      await routePlan(ctx);
    },
  });

  pi.registerShortcut(SHORTCUTS.modeMenu.keys, {
    description: SHORTCUTS.modeMenu.description,
    handler: async (ctx) => openControlCenter(ctx),
  });

  pi.on("context", async (event) => {
    let lastAssistantIndex = -1;
    for (let index = event.messages.length - 1; index >= 0; index -= 1) {
      const message = event.messages[index];
      if (!message || !isAssistantMessage(message)) continue;
      const hasToolCall = message.content.some(
        (block) => block.type === "toolCall",
      );
      // toolUse is an intermediate provider response. Other responses that
      // still carry tool calls also continue the same agent turn (for
      // example, Pi emits failed tool results after a truncated `length`
      // response). Error/aborted messages terminate immediately in Pi's
      // agent loop and therefore are valid stale-context boundaries.
      if (
        message.stopReason === "toolUse" ||
        (hasToolCall &&
          message.stopReason !== "error" &&
          message.stopReason !== "aborted")
      )
        continue;
      lastAssistantIndex = index;
      break;
    }
    // With no completed assistant turn there is no stale boundary. In
    // particular, the complete plan-mode-execute message sent by the first
    // /work turn must reach the model unchanged.
    if (lastAssistantIndex < 0) return;

    return {
      messages: event.messages.filter((message, index) => {
        // Keep the latest assistant response and every message injected for
        // the current turn. Only older workflow scaffolding is disposable.
        if (index >= lastAssistantIndex) return true;
        const candidate = message as AgentMessage & { customType?: string };
        if (
          candidate.customType?.startsWith("plan-") ||
          candidate.customType === "simple-plan-context"
        )
          return false;
        // Marker fallback is only for legacy hidden custom messages. Never
        // discard real user text merely because it discusses a marker.
        if (candidate.role !== "custom") return true;

        const content = candidate.content;
        if (typeof content === "string") {
          return (
            !content.includes(PLAN_MODE_MARKER) &&
            !content.includes(PLAN_REVIEW_MARKER) &&
            !content.includes(EXECUTING_PLAN_MARKER) &&
            !content.includes(DECISION_INTAKE_MARKER)
          );
        }
        if (Array.isArray(content)) {
          return !content.some(
            (block) =>
              block.type === "text" &&
              (block.text?.includes(PLAN_MODE_MARKER) ||
                block.text?.includes(PLAN_REVIEW_MARKER) ||
                block.text?.includes(EXECUTING_PLAN_MARKER) ||
                block.text?.includes(DECISION_INTAKE_MARKER)),
          );
        }
        return true;
      }),
    };
  });

  // Liefert einen Kontext-Zusatz mit dem aktuellen Decision Brief, falls eines
  // existiert. Wird an die simple_plan-/detailed_plan-Kontexte angehängt, damit
  // der folgende Plan-Turn die gewählte Richtung respektiert. Bleibt leer,
  // wenn kein Brief vorhanden ist.
  function decisionBriefContext(cwd: string): string {
    if (!decisionBriefHash) return "";
    let brief: string | undefined;
    try {
      brief = readDecisionBrief(cwd);
    } catch {
      return "";
    }
    if (!brief || hashPlanContent(brief) !== decisionBriefHash) return "";
    return `

ENTSCHEIDUNGS-KONTEXT (Decision Brief):
Ein Decision Brief liegt vor unter ${DECISION_BRIEF_RELATIVE_PATH}. Respektiere
die darin gewählte Richtung, öffne verworfene Optionen nicht erneut, übernimm
die getroffenen Entscheidungen, mache offene Fragen sichtbar und leite konkrete
Todos daraus ab. Frage nur dann erneut nach, wenn eine offene Frage wirklich
planungsrelevant ist.

<decision-brief>
${brief}
</decision-brief>`;
  }

  pi.on("before_agent_start", async (_event, ctx) => {
    try {
      planExistedBeforeTurn = readPlanFile(ctx.cwd) !== undefined;
    } catch {
      planExistedBeforeTurn = false;
    }

    if (phase === "deciding") {
      return {
        message: {
          customType: "plan-decision-context",
          content: `${DECISION_INTAKE_MARKER}
Du bist im Decision-Intake (Klärmodus). Deine Aufgabe ist ausschließlich, die
für die Umsetzung wesentlichen Entscheidungen zu klären — NICHT die Umsetzung
selbst und KEINEN finalen Arbeitsplan zu schreiben.

Vorgehen:
- Kläre Entscheidungen strukturiert über das Tool ask_user.
- Stelle pro ask_user-Aufruf genau EINE Frage mit 2–4 konkreten Optionen.
- Jede Option bekommt eine kurze Bedeutung / Konsequenz / Vor- bzw. Nachteil.
- Nenne zu jeder Frage immer eine Empfehlung.
- Stelle keine Fragen, deren Antwort aus dem Kontext ableitbar ist, und keine
  reinen Geschmacksfragen ohne Auswirkung auf Umsetzung, Risiko, UX,
  Sicherheit oder Architektur.
- Kläre stattdessen recherchierbare Fakten bei Bedarf selbst mit dem
  \`subagent\`-Tool (siehe AGENTS.md → Subagenten-Delegation), statt den
  Nutzer nach Bekanntem zu fragen.
- Prüfe nach jeder Frage, ob weitere Klärung wirklich nötig ist.
- Der Nutzer kann jederzeit abbrechen oder das Decision Brief erstellen lassen.

Budget:
- Standardmäßig höchstens ${DECISION_BUDGET_DEFAULT} Entscheidungsfragen.
- Bei größeren Architektur-, Workflow-, Permission-, UI/UX- oder
  Sicherheitsänderungen höchstens ${DECISION_BUDGET_COMPLEX} Fragen.
- Wenn nach Erreichen des Budgets noch offene Punkte bestehen, dokumentiere
  sie im Brief unter „Offene Fragen" statt endlos nachzufragen.

Abschluss:
- Schreibe KEINE Dateien und starte KEINE Umsetzung (auch nicht /work).
- Beende den Turn mit genau einem Block in dieser Form:

[DECISION-BRIEF]
# Decision Brief: <Aufgabe>

## Ziel
<Klare Beschreibung, was erreicht werden soll>

## Nicht-Ziele
<Was ausdrücklich nicht gemacht werden soll>

## Gewählte Richtung
<Kurze Zusammenfassung der empfohlenen Variante>

## Entscheidungen
- Entscheidung: ...
  Begründung: ...
  Status: entschieden

## Verworfene Optionen
- Option: ...
  Grund: ...

## Risiken / Constraints
- ...

## Offene Fragen
- ...

## Abschlusskriterien
- [ ] ...

## Empfohlener nächster Schritt
- Schnellplan oder Architekturplan
[/DECISION-BRIEF]

Pflicht sind die Abschnitte Ziel, Entscheidungen und Abschlusskriterien.
Das System speichert den Block als ${DECISION_BRIEF_RELATIVE_PATH} und bietet
danach den Handoff an. Stoppe nach dem Block.`,
          display: false,
        },
      };
    }

    if (phase === "reviewing") {
      return {
        message: {
          customType: "plan-review-context",
          content: `${PLAN_REVIEW_MARKER}
Prüfe den Plan auf Umsetzbarkeit, Vollständigkeit, Risiken, Tests und ungeklärte Entscheidungen.

Du darfst ausschließlich ${PLAN_RELATIVE_PATH} überarbeiten. Andere Schreibzugriffe sind verboten.
Wenn mehrere relevante Lösungen möglich sind, stelle vor dem Review-Ergebnis mit ask_user genau eine fokussierte Frage pro Aufruf. Biete jeweils 2–4 Optionen mit Vor-/Nachteilen und einer Empfehlung an.
Ziehe bei riskanten oder architektonisch unklaren Plänen bei Bedarf das \`subagent\`-Tool hinzu (siehe AGENTS.md → Subagenten-Delegation).

Ein Plan mit offenen entscheidungsrelevanten Fragen darf nicht als geprüft markiert werden.
Beende den Review mit genau einem Marker:
- [PLAN-REVIEW:APPROVED]
- [PLAN-REVIEW:CHANGES-REQUIRED]`,
          display: false,
        },
      };
    }

    if (mode === "simple_plan") {
      return {
        message: {
          customType: "simple-plan-context",
          content: SIMPLE_PLAN_PROMPT + decisionBriefContext(ctx.cwd),
          display: false,
        },
      };
    }

    if (mode === "detailed_plan") {
      return {
        message: {
          customType: "plan-mode-context",
          content:
            `${PLAN_MODE_MARKER}
Du bist im ausführlichen Plan-Modus. Analysiere Kontext, Risiken, Optionen,
Abhängigkeiten und Umsetzungsschritte gründlich. Der Workflow-Modus verändert
keine Permissions; halte die aktuell gewählte Zugriffsstufe ein.

Führe die Aufgabe nicht aus. Schreibe ausschließlich den Plan nach
${PLAN_RELATIVE_PATH}, sofern die aktuelle Permission-Stufe dies erlaubt.

ENTSCHEIDUNGEN:
Wenn mehrere relevante Lösungen möglich sind, nutze vor dem finalen Plan ask_user.
Stelle pro Aufruf genau eine fokussierte Frage und biete 2–4 Optionen mit Vor-/Nachteilen und Empfehlung an.

SUBAGENTEN:
Nutze das \`subagent\`-Tool bei Bedarf, wenn eine Teilaufgabe dazu passt (siehe AGENTS.md → Subagenten-Delegation).

PLANSTRUKTUR (alle Abschnitte sind Pflicht):
# Arbeitsplan: <Aufgabe>

## 1. Auftrag
## 2. Nicht-Ziele
## 3. Betroffene Bereiche
## 4. Risiken / Entscheidungen
## 5. Todos
- [ ] Konkreter Schritt
## 6. Tests / Checks
- Was nach der Umsetzung geprüft werden muss
## 7. Abschlusskriterien
- Woran erkennbar ist, dass die Aufgabe vollständig erledigt ist

Alle 7 Abschnitte sind Pflicht. Leere Abschnitte sind nicht erlaubt.
/work validiert den Plan vor dem Start und stoppt bei fehlenden Abschnitten.

Schreibe den finalen Plan nach ${PLAN_RELATIVE_PATH} und stoppe danach.
Nächster Schritt: /work. Bei großen, riskanten oder architektonischen Änderungen optional vorher /review-plan.` +
            decisionBriefContext(ctx.cwd),
          display: false,
        },
      };
    }

    if (phase === "executing") {
      if (!isCurrentRun("executing", ctx)) {
        phase = "paused";
        updateStatus(ctx);
        persistState(ctx);
        return;
      }
      const executionId = activeRun?.id;
      if (!executionId) return;
      let todos: TodoItem[] = [];
      try {
        todos = readTodos(ctx.cwd).filter((todo) => !todo.completed);
      } catch {
        // The command path performs the user-facing error handling.
      }
      const todoList = todos
        .map((todo) => `T${todo.step}. ${todo.text}`)
        .join("\n");
      return {
        message: {
          customType: "plan-execution-context",
          content: `${EXECUTING_PLAN_MARKER} — aktuelle Permission-Stufe bleibt aktiv

Execution-ID: ${executionId}

Offene Schritte:
${todoList || "Keine offenen Todos gefunden."}

STOP-REGELN (verbindlich):
- Prüfe vor jedem Schritt, ob er noch zum Plan passt. Weiche nicht ab.
- Keine stillen Scope-Erweiterungen, keine neuen Features außerhalb des Plans.
- Keine neuen Dependencies, Commits oder Pushes ohne ausdrückliche Freigabe.
- Markiere einen Schritt nur als erledigt, wenn du einen konkreten Nachweis hast.
- Stoppe und melde einen Blocker, wenn Plan und Realität in Konflikt stehen.

${SUBAGENT_EXECUTING_REMINDER}

FORTSCHRITT:
- Nutze \`plan_progress\` mit \`executionId: "${executionId}"\` für jeden Statuswechsel eines Todos.
- \`completed\` ist nur mit konkretem Nachweis zulässig.
- \`blocked\` braucht die konkrete Ursache als Nachweis.
- Textmarker sind nur noch ein Legacy-Fallback; der Toolzustand ist maßgeblich.`,
          display: false,
        },
      };
    }
  });

  pi.on("turn_end", async (event, ctx) => {
    if (
      phase !== "executing" ||
      !isCurrentRun("executing", ctx) ||
      !isAssistantMessage(event.message)
    )
      return;

    try {
      const current = readPlanFile(ctx.cwd);
      if (current === undefined) {
        phase = "draft";
        reviewedHash = undefined;
        ctx.ui.notify("Plan-Datei fehlt. Ausführung wurde gestoppt.", "error");
        updateStatus(ctx);
        persistState(ctx);
        return;
      }

      const text = getTextContent(event.message);
      const progressSteps = extractProgressBlock(text);
      const completedSteps =
        progressSteps !== undefined ? progressSteps : extractDoneSteps(text);
      const result = applyDoneSteps(current, completedSteps);
      if (result.updated > 0) {
        writePlanFileAtomic(ctx.cwd, result.content);
        const updatedAt = new Date().toISOString();
        const completed = new Set(completedSteps);
        progressRecords = [
          ...progressRecords.filter((record) => !completed.has(record.step)),
          ...extractTodoItems(result.content)
            .filter((todo) => completed.has(todo.step) && todo.completed)
            .map((todo) => ({
              step: todo.step,
              status: "completed" as const,
              evidence: "Über Legacy-Fortschrittsmarker gemeldet.",
              updatedAt,
            })),
        ].sort((a, b) => a.step - b.step);
      }

      const todos = extractTodoItems(result.content);
      if (todos.length > 0 && todos.every((todo) => todo.completed)) {
        phase = "ready";
        updateStatus(ctx);
        persistState(ctx);
        return;
      }
      updateStatus(ctx);
      persistState(ctx);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(
        `Todo-Status konnte nicht aktualisiert werden: ${message}`,
        "error",
      );
    }
  });

  pi.on("agent_end", async (event, ctx) => {
    if (phase === "ready" && isCurrentRun("executing", ctx)) {
      activeRun = undefined;
      archiveCompletedPlan(ctx);
      return;
    }

    if (phase === "blocked" && isCurrentRun("executing", ctx)) {
      activeRun = undefined;
      updateStatus(ctx);
      persistState(ctx);
      return;
    }

    if (phase === "deciding") {
      if (!isCurrentRun("deciding", ctx)) return;
      await handleDecisionTurnEnd(event, ctx);
      return;
    }

    if (phase === "reviewing") {
      if (!isCurrentRun("reviewing", ctx)) return;
      const reviewText = getLatestAssistantText(event.messages);
      const outcome = getReviewOutcome(reviewText);

      try {
        const content = readPlanFile(ctx.cwd);
        const structureErrors =
          content === undefined
            ? [`Plan-Datei fehlt: ${PLAN_RELATIVE_PATH}`]
            : validatePlanStructure(content, effectivePlanType(content));

        if (
          outcome === "approved" &&
          content !== undefined &&
          structureErrors.length === 0
        ) {
          reviewedHash = hashPlanContent(content);
          phase = "reviewed";
          ctx.ui.notify(
            "Plan geprüft. Der Reviewstatus ist erfasst; `/work` bleibt davon unabhängig verfügbar.",
            "info",
          );
        } else {
          reviewedHash = undefined;
          phase = "draft";
          const details =
            structureErrors.length > 0
              ? `\n${structureErrors.join("\n")}`
              : outcome === "changes-required"
                ? "\nDer Review verlangt Änderungen."
                : "\nDer verbindliche Review-Marker fehlt.";
          ctx.ui.notify(
            `Review nicht abgeschlossen.${details}\nOptional nach Korrektur erneut /review-plan ausführen.`,
            "warning",
          );
        }
      } catch (error) {
        reviewedHash = undefined;
        phase = "draft";
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Plan-Review fehlgeschlagen: ${message}`, "error");
      }

      updateStatus(ctx);
      persistState(ctx);
      activeRun = undefined;
      return;
    }

    if (
      phase !== "draft" ||
      (mode !== "simple_plan" && mode !== "detailed_plan")
    )
      return;
    try {
      let content = readPlanFile(ctx.cwd);
      if (content !== undefined) {
        const preMetadataHash = hashPlanContent(content);
        const replacedPlan =
          pendingPlan !== undefined &&
          (pendingPlan.previousHash === undefined ||
            preMetadataHash !== pendingPlan.previousHash);
        if (replacedPlan && pendingPlan) {
          planCreationMode = pendingPlan.mode;
          progressRecords = [];
          reviewedHash = undefined;
          currentPlanId = undefined;
          pendingPlan = undefined;
        }
        if (
          !planExistedBeforeTurn &&
          !replacedPlan &&
          (mode === "simple_plan" || mode === "detailed_plan")
        ) {
          planCreationMode = mode;
        }
        if (planCreationMode) {
          const metadata = ensurePlanMetadataHeader(
            content,
            planCreationMode,
            currentPlanId,
          );
          if (metadata.changed) writePlanFileAtomic(ctx.cwd, metadata.content);
          content = metadata.content;
          currentPlanId = metadata.metadata.planId;
        }
        updateStatus(ctx);
        ctx.ui.notify(`Plan gespeichert → ${PLAN_RELATIVE_PATH}`, "info");
        // Das "Nächster Schritt"-Menü erscheint nur nach dem Turn, der die
        // Plan-Datei neu erzeugt hat — Verfeinerungs-Turns bleiben menüfrei.
        if (!planExistedBeforeTurn || replacedPlan) {
          planExistedBeforeTurn = true;
          persistState(ctx);
          await offerPostPlanActions(ctx);
        } else {
          // A refinement can change the plan hash even when no workflow phase
          // changes. Keep the sidecar synchronized with that Markdown edit.
          persistState(ctx);
        }
      } else if (pendingPlan) {
        pendingPlan = undefined;
        ctx.ui.notify(
          "Der neue Plan wurde nicht erstellt; der Pending-Zustand wurde zurückgesetzt.",
          "warning",
        );
      }
    } catch {
      // Die zentrale Permission-Policy meldet unsichere Pfade separat.
    }
  });

  async function reviewPlan(ctx: ExtensionContext): Promise<void> {
    if (!(await confirmAbortActiveTurn(ctx))) return;
    normalizeInterruptedPhase(ctx);

    let content: string | undefined;
    try {
      content = readPlanFile(ctx.cwd);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`Plan-Datei ist nicht sicher lesbar: ${message}`, "error");
      return;
    }
    if (content === undefined) {
      ctx.ui.notify(
        `Keine Plan-Datei gefunden: ${PLAN_RELATIVE_PATH}\nErstelle zuerst einen Plan mit /plan.`,
        "warning",
      );
      return;
    }

    reviewedHash = undefined;
    phase = "reviewing";
    startRun("reviewing", ctx, hashPlanContent(content));
    updateStatus(ctx);
    persistState(ctx);

    const structureErrors = validatePlanStructure(content, effectivePlanType(content));
    const staticFindings =
      structureErrors.length === 0
        ? "Die formale Planstruktur ist vollständig."
        : `Formale Befunde:\n- ${structureErrors.join("\n- ")}`;

    pi.sendMessage(
      {
        customType: "plan-review-request",
        content: `[PLAN REVIEW REQUEST]
${staticFindings}

Prüfe jetzt den folgenden Plan inhaltlich. Überarbeite bei Bedarf ausschließlich ${PLAN_RELATIVE_PATH}. Kläre entscheidungsrelevante Alternativen strukturiert mit ask_user.

<plan>
${content}
</plan>`,
        display: true,
      },
      { triggerTurn: true },
    );
  }

  // Archiviert ein vorhandenes Decision Brief zusammen mit dem Plan, damit es
  // nicht als veralteter Kontext in spätere, fremde Plan-Turns injiziert wird.
  // Fehler sind nicht fatal: das Plan-Archiv gilt unabhängig davon.
  function archiveBriefAlongsidePlan(ctx: ExtensionContext): void {
    decisionBriefHash = undefined;
    try {
      if (readDecisionBrief(ctx.cwd) === undefined) return;
      archiveDecisionBrief(ctx.cwd);
      ctx.ui.notify("Decision Brief mitarchiviert.", "info");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(
        `Decision Brief konnte nicht mitarchiviert werden: ${message}`,
        "warning",
      );
    }
  }

  // Gemeinsamer Abschlusspfad für turn_end-Autoarchiv, /done und den
  // "alle Todos erledigt"-Fall von /work. Bei Archivfehlern bleibt die Phase
  // auf "ready", damit /finish als Retry dient.
  function archiveCompletedPlan(ctx: ExtensionContext): boolean {
    let archived = false;
    try {
      const archivePath = archivePlanFile(ctx.cwd, "complete");
      archiveBriefAlongsidePlan(ctx);
      phase = mode !== "work" ? "draft" : "idle";
      reviewedHash = undefined;
      archived = true;
      pi.sendMessage(
        {
          customType: "plan-complete",
          content: `**Plan vollständig bearbeitet und archiviert:** ${relative(ctx.cwd, archivePath)}`,
          display: true,
        },
        { triggerTurn: false },
      );
    } catch (error) {
      phase = "ready";
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(
        `Alle Todos erledigt, Archivierung fehlgeschlagen: ${message}\nNutze /finish erneut.`,
        "warning",
      );
    }
    updateStatus(ctx);
    persistState(ctx);
    return archived;
  }

  async function executePlan(ctx: ExtensionContext): Promise<void> {
    if (phase === "executing" && !ctx.isIdle()) {
      ctx.ui.notify("Plan wird bereits ausgeführt.", "warning");
      return;
    }
    if (!(await confirmAbortActiveTurn(ctx))) return;
    normalizeInterruptedPhase(ctx);

    let content: string | undefined;
    try {
      content = readPlanFile(ctx.cwd);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`Plan-Datei ist nicht sicher lesbar: ${message}`, "error");
      return;
    }

    if (content === undefined) {
      await setWorkflowMode("work", ctx, { force: true, skipAbort: true });
      phase = "idle";
      activeRun = undefined;
      updateStatus(ctx);
      persistState(ctx);
      ctx.ui.notify(
        `Work Mode aktiv. Keine Plan-Datei gefunden: ${PLAN_RELATIVE_PATH}`,
        "info",
      );
      return;
    }
    const structureErrors = validatePlanStructure(content, effectivePlanType(content));
    if (structureErrors.length > 0) {
      phase = "draft";
      reviewedHash = undefined;
      updateStatus(ctx);
      persistState(ctx);
      ctx.ui.notify(
        `Planstruktur ist nicht mehr gültig:\n${structureErrors.join("\n")}`,
        "warning",
      );
      return;
    }

    if (!ctx.isProjectTrusted()) {
      if (!ctx.hasUI || ctx.mode !== "tui") {
        ctx.ui.notify(
          "Ein Plan aus einem nicht vertrauenswürdigen Workspace kann non-interaktiv nicht ausgeführt werden.",
          "warning",
        );
        return;
      }
      const trustedResume = await ctx.ui.confirm(
        "Plan aus nicht vertrauenswürdigem Workspace ausführen?",
        "Der Planinhalt stammt aus dem aktuellen Repository. Nur fortfahren, wenn du ihn geprüft hast.",
      );
      if (!trustedResume) return;
    }

    if (phase === "paused" || phase === "blocked") {
      if (!ctx.hasUI || ctx.mode !== "tui") {
        ctx.ui.notify(
          "Eine pausierte oder blockierte Ausführung benötigt eine interaktive Resume-Bestätigung.",
          "warning",
        );
        return;
      }
      const resume = await ctx.ui.confirm(
        phase === "blocked" ? "Blockierten Plan fortsetzen?" : "Pausierten Plan fortsetzen?",
        "Der Planhash wird erneut geprüft und eine neue Execution-ID erzeugt.",
      );
      if (!resume) return;
    }

    if (reviewedHash && reviewedHash !== hashPlanContent(content)) {
      // Review ist reine Statusinformation und darf /work niemals blockieren.
      reviewedHash = undefined;
      if (phase === "reviewed") phase = "draft";
    }

    const todos = extractTodoItems(content);
    if (todos.every((todo) => todo.completed)) {
      await setWorkflowMode("work", ctx, { force: true, skipAbort: true });
      phase = "ready";
      updateStatus(ctx);
      persistState(ctx);
      if (ctx.hasUI && ctx.mode === "tui") {
        const confirmed = await ctx.ui.confirm(
          "Alle Plan-Todos sind bereits erledigt.",
          "Plan jetzt archivieren?",
        );
        if (confirmed) {
          archiveCompletedPlan(ctx);
          return;
        }
      }
      ctx.ui.notify(
        "Alle Plan-Todos sind bereits erledigt. Nutze /finish.",
        "info",
      );
      return;
    }

    if (!(await setWorkflowMode("work", ctx, { force: true, skipAbort: true })))
      return;
    phase = "executing";
    reviewedHash = undefined;
    mode = "work";
    const executionId = startRun(
      "executing",
      ctx,
      hashPlanContent(content),
    );
    updateStatus(ctx);
    persistState(ctx);

    try {
      pi.sendMessage(
        {
          customType: "plan-mode-execute",
          content: `${EXECUTING_PLAN_MARKER}

Plan-Datei: ${PLAN_RELATIVE_PATH}
Execution-ID: ${executionId}

${content}

Setze den Plan Schritt für Schritt um. Die Todos sind als T1, T2, … nummeriert.

STOP-REGELN (verbindlich):
- Prüfe zuerst, ob der Plan noch zum aktuellen Repo-Zustand passt.
- Keine stillen Scope-Erweiterungen, keine neuen Features außerhalb des Plans.
- Keine neuen Dependencies, Commits oder Pushes ohne ausdrückliche Freigabe.
- Markiere einen Schritt nur als erledigt, wenn du einen konkreten Nachweis hast.
- Stoppe und melde einen Blocker, wenn Plan und Realität in Konflikt stehen.

${SUBAGENT_EXECUTING_REMINDER}

Aktualisiere jeden Todo-Status explizit mit \`plan_progress\` und übergib dabei
\`executionId: "${executionId}"\`. Verwende
\`completed\` nur mit einem konkreten Nachweis und \`blocked\` nur mit konkreter
Ursache. Schreibe zusätzlich einen [WORK-RESULT]-Block als lesbaren Bericht:

[WORK-RESULT]
DONE:
- T1: <was wurde getan>

CHECKS:
- <was wurde geprüft>

BLOCKED:
- <was ist blockiert und warum>

CHANGED_FILES:
- <geänderte Dateien>
[/WORK-RESULT]`,
          display: true,
        },
        { triggerTurn: true },
      );
    } catch (error) {
      phase = "paused";
      activeRun = undefined;
      const message = error instanceof Error ? error.message : String(error);
      updateStatus(ctx);
      persistState(ctx);
      ctx.ui.notify(`Planausführung konnte nicht gestartet werden: ${message}`, "error");
    }
  }

  function planProgressResult(
    text: string,
    details: Record<string, unknown>,
  ) {
    return {
      content: [{ type: "text" as const, text }],
      details,
    };
  }

  pi.registerTool({
    name: "plan_progress",
    label: "Plan Progress",
    description:
      "Aktualisiert während /work genau ein Todo des aktiven Plans. Nutze in_progress beim Start, completed ausschließlich mit überprüfbarem Nachweis und blocked mit konkreter Ursache.",
    parameters: PlanProgressParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const evidence = params.evidence.trim();
      const status = params.status as PlanProgressStatus;
      if (evidence.length === 0) {
        return planProgressResult(
          "Fehler: evidence darf nicht leer sein.",
          { ok: false, step: params.step, status },
        );
      }
      if (evidence.length > 1000) {
        return planProgressResult(
          "Fehler: evidence darf höchstens 1000 Zeichen enthalten.",
          { ok: false, step: params.step, status },
        );
      }
      if (phase !== "executing" || mode !== "work") {
        return planProgressResult(
          "Fehler: plan_progress ist nur während einer mit /work gestarteten Planausführung verfügbar.",
          { ok: false, step: params.step, status, phase, mode },
        );
      }
      if (
        !isCurrentRun("executing", ctx) ||
        params.executionId !== activeRun?.id
      ) {
        return planProgressResult(
          "Fehler: Die Execution-ID gehört nicht zur aktuell aktiven Planausführung. Nutze /work für einen sicheren Resume.",
          { ok: false, step: params.step, status },
        );
      }

      let content: string | undefined;
      try {
        content = readPlanFile(ctx.cwd);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return planProgressResult(
          `Fehler: Plan-Datei ist nicht sicher lesbar: ${message}`,
          { ok: false, step: params.step, status },
        );
      }
      if (content === undefined) {
        phase = "paused";
        reviewedHash = undefined;
        persistState(ctx);
        updateStatus(ctx);
        return planProgressResult("Fehler: Keine aktive Plan-Datei vorhanden.", {
          ok: false,
          step: params.step,
          status,
        });
      }

      const currentHash = hashPlanContent(content);
      if (activeRun.planHash && currentHash !== activeRun.planHash) {
        phase = "paused";
        const expectedHash = activeRun.planHash;
        activeRun = undefined;
        persistState(ctx);
        updateStatus(ctx);
        return planProgressResult(
          "Fehler: Der Plan wurde außerhalb dieser Execution verändert. Die Ausführung wurde pausiert; prüfe den Plan und starte /work erneut.",
          { ok: false, step: params.step, status, expectedHash, currentHash },
        );
      }

      const todos = extractTodoItems(content);
      const todo = todos.find((candidate) => candidate.step === params.step);
      if (!todo) {
        return planProgressResult(
          `Fehler: T${params.step} existiert nicht. Gültig sind ${todos.length > 0 ? `T1–T${todos.length}` : "keine Todos"}.`,
          {
            ok: false,
            step: params.step,
            status,
            validSteps: todos.map((candidate) => candidate.step),
          },
        );
      }
      if (todo.completed && status !== "completed") {
        return planProgressResult(
          `Fehler: T${params.step} ist im Markdown bereits erledigt und kann nicht auf ${status} zurückgesetzt werden.`,
          {
            ok: false,
            step: params.step,
            status,
            currentStatus: "completed",
          },
        );
      }
      const otherActive = progressRecords.find(
        (record) =>
          record.status === "in_progress" && record.step !== params.step,
      );
      if (status === "in_progress" && otherActive) {
        return planProgressResult(
          `Fehler: T${otherActive.step} ist bereits in Arbeit. Schließe oder blockiere diesen Schritt zuerst.`,
          {
            ok: false,
            step: params.step,
            status,
            activeStep: otherActive.step,
          },
        );
      }

      const now = new Date().toISOString();
      const previousProgressRecords = progressRecords;
      const record: PlanProgressRecord = {
        step: params.step,
        status,
        evidence,
        updatedAt: now,
      };
      progressRecords = [
        ...progressRecords.filter((candidate) => candidate.step !== params.step),
        record,
      ].sort((a, b) => a.step - b.step);

      let updatedContent = content;
      let checkboxUpdated = false;
      if (status === "completed") {
        const result = applyDoneSteps(content, [params.step]);
        updatedContent = result.content;
        checkboxUpdated = result.updated === 1;
        if (checkboxUpdated) {
          try {
            writePlanFileAtomic(ctx.cwd, updatedContent);
          } catch (error) {
            progressRecords = previousProgressRecords;
            const message =
              error instanceof Error ? error.message : String(error);
            return planProgressResult(
              `Fehler: Todo konnte nicht atomar aktualisiert werden: ${message}`,
              { ok: false, step: params.step, status },
            );
          }
          activeRun.planHash = hashPlanContent(updatedContent);
        }
      }

      if (status === "blocked") {
        phase = "blocked";
        persistState(ctx);
        updateStatus(ctx);
        return planProgressResult(
          `T${params.step} (${todo.text}) ist blockiert. Die Ausführung bleibt bis zu einem expliziten /work-Resume pausiert. Ursache: ${evidence}`,
          {
            ok: true,
            step: params.step,
            status,
            evidence,
            checkboxUpdated: false,
            archived: false,
          },
        );
      }

      const nextTodos = extractTodoItems(updatedContent);
      if (
        nextTodos.length > 0 &&
        nextTodos.every((candidate) => candidate.completed)
      ) {
        phase = "ready";
        persistState(ctx);
        updateStatus(ctx);
        return planProgressResult(
          `T${params.step} als completed erfasst; alle Todos sind erledigt. Der Plan wird nach dem erfolgreichen Turn-Ende archiviert.`,
          {
            ok: true,
            step: params.step,
            status,
            evidence,
            checkboxUpdated,
            archived: false,
            ready: true,
          },
        );
      }

      persistState(ctx);
      updateStatus(ctx);
      const statusLabel =
        status === "completed"
          ? "erledigt"
          : "in Arbeit";
      return planProgressResult(
        `T${params.step} (${todo.text}) ist jetzt ${statusLabel}. Nachweis: ${evidence}`,
        {
          ok: true,
          step: params.step,
          status,
          evidence,
          checkboxUpdated,
          archived: false,
        },
      );
    },
  });

  pi.registerCommand("review-plan", {
    description: "Aktuelle Plan-Datei optional vertieft prüfen",
    handler: async (_args, ctx) => reviewPlan(ctx),
  });

  pi.registerCommand("work", {
    description: "Plan ausführen",
    handler: async (_args, ctx) => executePlan(ctx),
  });

  pi.registerCommand("go", {
    description: "Alias für /work",
    handler: async (_args, ctx) => executePlan(ctx),
  });

  // Fallback für vergessene [DONE:n]-Marker: hakt Todos manuell ab und nutzt
  // denselben Abschluss-/Archivpfad wie die automatische Erkennung. Ohne den
  // Befehl bliebe ein Plan, dessen Marker das Modell ausgelassen hat, dauerhaft
  // "executing".
  pi.registerCommand("done", {
    description: "Plan-Todos manuell abhaken: /done <n> [m …]",
    handler: async (args, ctx) => {
      const steps = args.trim().split(/\s+/).filter(Boolean).map(Number);
      if (
        steps.length === 0 ||
        steps.some((step) => !Number.isSafeInteger(step) || step <= 0)
      ) {
        ctx.ui.notify(
          "Nutzung: /done <n> [m …] — Nummern wie in /plan-todos",
          "info",
        );
        return;
      }

      let content: string | undefined;
      try {
        content = readPlanFile(ctx.cwd);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(
          `Plan-Datei ist nicht sicher lesbar: ${message}`,
          "error",
        );
        return;
      }
      if (content === undefined) {
        ctx.ui.notify("Keine Plan-Datei vorhanden.", "info");
        return;
      }

      const result = applyDoneSteps(content, steps);
      if (result.updated === 0) {
        ctx.ui.notify(
          "Keine passende offene Todo-Nummer gefunden (bereits erledigt oder außerhalb des Bereichs).",
          "warning",
        );
        return;
      }
      try {
        writePlanFileAtomic(ctx.cwd, result.content);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(
          `Plan-Datei konnte nicht aktualisiert werden: ${message}`,
          "error",
        );
        return;
      }
      ctx.ui.notify(
        `${result.updated} Todo${result.updated === 1 ? "" : "s"} abgehakt.`,
        "info",
      );

      const todos = extractTodoItems(result.content);
      if (todos.length > 0 && todos.every((todo) => todo.completed)) {
        archiveCompletedPlan(ctx);
        return;
      }
      updateStatus(ctx);
      persistState(ctx);
    },
  });

  async function finishPlan(ctx: ExtensionCommandContext): Promise<void> {
    await ctx.waitForIdle();

    let content: string | undefined;
    try {
      content = readPlanFile(ctx.cwd);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`Plan-Datei ist nicht sicher lesbar: ${message}`, "error");
      return;
    }

    if (content === undefined) {
      phase = mode === "work" ? "idle" : "draft";
      reviewedHash = undefined;
      updateStatus(ctx);
      persistState(ctx);
      ctx.ui.notify("Keine Plan-Datei vorhanden.", "info");
      return;
    }

    const todos = extractTodoItems(content);
    const complete = todos.length > 0 && todos.every((todo) => todo.completed);
    if (!complete) {
      if (!ctx.hasUI) {
        ctx.ui.notify(
          "Offene Todos können ohne interaktive Bestätigung nicht archiviert werden.",
          "warning",
        );
        return;
      }
      const confirmed = await ctx.ui.confirm(
        "Plan mit offenen Todos archivieren?",
        "Der Plan wird als incomplete archiviert und aus current-plan.md entfernt.",
      );
      if (!confirmed) {
        ctx.ui.notify("Abschluss abgebrochen.", "info");
        return;
      }
    }

    try {
      const keepPlanMode = mode !== "work";
      const archivePath = archivePlanFile(
        ctx.cwd,
        complete ? "complete" : "incomplete",
      );
      archiveBriefAlongsidePlan(ctx);
      phase = keepPlanMode ? "draft" : "idle";
      reviewedHash = undefined;
      updateStatus(ctx);
      persistState(ctx);
      ctx.ui.notify(
        `Plan archiviert: ${relative(ctx.cwd, archivePath)}`,
        "info",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(
        `Archivierung fehlgeschlagen; aktuelle Plan-Datei bleibt erhalten: ${message}`,
        "error",
      );
    }
  }

  pi.registerCommand("finish", {
    description: "Plan abschließen und sicher archivieren",
    handler: async (_args, ctx) => finishPlan(ctx),
  });

  pi.on("session_start", async (_event, ctx) => {
    // Extension instances can serve more than one session. Never let an
    // earlier project's in-memory workflow leak into a new empty session.
    mode = "work";
    phase = "idle";
    reviewedHash = undefined;
    planCreationMode = undefined;
    progressRecords = [];
    workflowRevision = 0;
    currentPlanId = undefined;
    decisionBriefHash = undefined;
    sidecarCasReady = false;
    activeRun = undefined;
    pendingPlan = undefined;
    sessionEpoch += 1;
    activeSessionId = ctx.sessionManager.getSessionId();
    projectTrusted = ctx.isProjectTrusted();
    planModeEverUsed = false;
    planExistedBeforeTurn = false;
    latestCwd = ctx.cwd;
    auroraEpoch = undefined;
    subscribeAuroraProvider();

    if (!projectTrusted) {
      let untrustedPlanExists = false;
      try {
        untrustedPlanExists = readPlanFile(ctx.cwd) !== undefined;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Unsicherer Planpfad ignoriert: ${message}`, "error");
      }
      planExistedBeforeTurn = untrustedPlanExists;
      updateStatus(ctx);
      if (untrustedPlanExists) {
        ctx.ui.notify(
          "Plan-Artefakte aus dem nicht vertrauenswürdigen Workspace bleiben inaktiv. /work verlangt eine explizite Bestätigung.",
          "warning",
        );
      }
      return;
    }

    const entries = ctx.sessionManager.getEntries();
    const latestState = entries
      .filter(
        (entry: { type: string; customType?: string }) =>
          entry.type === "custom" && entry.customType === "plan-mode",
      )
      .pop() as { data?: PersistedWorkflowState } | undefined;

    const persisted = latestState?.data;
    if (persisted?.phase) {
      phase = persisted.phase;
      mode =
        persisted.mode ?? (persisted.planningActive ? "detailed_plan" : "work");
      reviewedHash = persisted.reviewedHash;
      planCreationMode = persisted.planCreationMode;
    } else if (persisted) {
      phase = persisted.executing
        ? "executing"
        : persisted.enabled
          ? "draft"
          : "idle";
      mode = persisted.enabled ? "detailed_plan" : "work";
    }

    let content: string | undefined;
    try {
      content = readPlanFile(ctx.cwd);
      const loaded = loadWorkflowState(ctx.cwd);
      if (loaded.state) {
        mode = loaded.state.mode;
        phase = loaded.state.phase;
        reviewedHash = loaded.state.reviewedHash;
        planCreationMode = loaded.state.planCreationMode;
        progressRecords = loaded.state.progress;
        workflowRevision = loaded.state.revision;
        currentPlanId = loaded.state.planId;
        decisionBriefHash = loaded.state.decisionBriefHash;
        sidecarCasReady = !loaded.recovered;
      } else {
        progressRecords = [];
        workflowRevision = 0;
        currentPlanId = undefined;
        decisionBriefHash = undefined;
        sidecarCasReady = false;
      }
      if (loaded.warning) ctx.ui.notify(loaded.warning, "warning");
    } catch (error) {
      phase = "idle";
      mode = "work";
      reviewedHash = undefined;
      progressRecords = [];
      workflowRevision = 0;
      currentPlanId = undefined;
      decisionBriefHash = undefined;
      sidecarCasReady = false;
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`Unsicherer Planpfad ignoriert: ${message}`, "error");
    }

    planExistedBeforeTurn = content !== undefined;

    if (content === undefined) {
      phase = "idle";
      reviewedHash = undefined;
    } else {
      planModeEverUsed = true;
      if (phase === "idle") phase = "draft";
      if (phase === "reviewing") phase = "draft";
      if (phase === "deciding") phase = "draft";
      if (
        phase === "reviewed" &&
        (!reviewedHash || hashPlanContent(content) !== reviewedHash)
      ) {
        // reviewedHash bleibt bis /work erhalten, damit der veraltete
        // Reviewstatus auch nach einem Sessionneustart erkannt wird.
        phase = "draft";
      }
      if (
        phase === "executing" ||
        phase === "paused" ||
        phase === "blocked" ||
        phase === "ready"
      ) {
        const todos = extractTodoItems(content);
        phase =
          todos.length > 0 && todos.every((todo) => todo.completed)
            ? "ready"
            : phase === "blocked"
              ? "blocked"
              : "paused";
      }
    }

    if (pi.getFlag("plan") === true) {
      phase = "draft";
      reviewedHash = undefined;
      mode = "detailed_plan";
      planModeEverUsed = true;
    }

    if (mode !== "work" && phase === "idle") phase = "draft";
    if (mode !== "work" && !preparePlan(ctx)) {
      mode = "work";
      phase = "idle";
    }
    updateStatus(ctx);
    persistState(ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    if (phase === "executing") {
      phase = "paused";
      activeRun = undefined;
      persistState(ctx);
    }
    sessionEpoch += 1;
    activeSessionId = undefined;
    unsubscribeAurora?.();
    unsubscribeAurora = undefined;
    auroraEpoch = undefined;
    latestCwd = undefined;
    setTuiStatus(ctx, ZENTUI_STATUS_KEYS.workflow, undefined);
  });
}
