/**
 * Plan workflow extension.
 *
 * Workflow: /plan -> /work (review-plan optional, finish meist automatisch)
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, TextContent } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { relative } from "node:path";
import {
  applyDoneSteps,
  archiveDecisionBrief,
  archivePlanFile,
  DECISION_BRIEF_RELATIVE_PATH,
  DECISION_BUDGET_COMPLEX,
  DECISION_BUDGET_DEFAULT,
  ensurePlanDirectory,
  extractDecisionBriefBlock,
  extractDoneSteps,
  extractTodoItems,
  getReviewOutcome,
  hashPlanContent,
  PLAN_RELATIVE_PATH,
  readDecisionBrief,
  readPlanFile,
  validatePlanStructure,
  writeDecisionBriefAtomic,
  writePlanFileAtomic,
  type TodoItem,
} from "./utils.ts";
import {
  PLAN_ACTION_REQUEST_EVENT,
  WORKFLOW_MODE_REQUEST_EVENT,
  WORKFLOW_STATUS_EVENT,
  type PlanActionRequest,
  type WorkflowMode,
  type WorkflowModeRequest,
  type WorkflowPhase,
} from "../shared/workflow-status.ts";
import { runMenu, type MenuEntry } from "../shared/menu-ui.ts";
import {
  buildBriefOverwriteGuardMenu,
  buildDecisionHandoffMenu,
  buildOverwriteGuardMenu,
  buildPlanAssistantMenu,
  type DecisionHandoffAction,
  type OverwriteDecision,
  type PlanAssistantAction,
} from "./plan-menu.ts";

// Context markers: kept as constants so injection (below) and detection (in
// the "context" handler) can never drift apart, unlike two separately
// hand-typed copies of the same bracketed text.
const PLAN_MODE_MARKER = "[PLAN MODE ACTIVE]";
const PLAN_REVIEW_MARKER = "[PLAN REVIEW ACTIVE]";
const EXECUTING_PLAN_MARKER = "[EXECUTING PLAN]";
const DECISION_INTAKE_MARKER = "[DECISION INTAKE ACTIVE]";

// Persistenter Kontext für den „Einfachen Plan": dieselbe Plan-Datei wie im
// ausführlichen Modus, aber ohne lange Architektur-/Risiko-Blöcke.
const SIMPLE_PLAN_PROMPT = `[EINFACHER PLAN]
Erstelle einen schlichten, schnell einsetzbaren Plan für die aktuelle Aufgabe — geeignet für kleine bis mittlere Änderungen.

Vorgehen:
- Stelle höchstens wenige gezielte Rückfragen, und nur, wenn sie für einen umsetzbaren Plan wirklich nötig sind (nutze dazu ask_user).
- Verzichte auf ausführliche Architekturprüfung und lange Risiko-/Audit-Blöcke.
- Führe die Aufgabe nicht aus und ändere keine anderen Dateien.

Schreibe den finalen kurzen Plan nach ${PLAN_RELATIVE_PATH}.
Verwende mindestens diese gültige Struktur:

# Arbeitsplan: <Aufgabe>

## 1. Auftrag
<Kurze Zielbeschreibung>

## 5. Todos
- [ ] Konkreter Umsetzungsschritt
- [ ] Relevante Tests oder Checks ausführen

Pflicht sind Abschnitt 1 und Abschnitt 5 mit mindestens einer Checkbox.
Stoppe nach dem Schreiben der Plan-Datei und bleibe knapp.`;

interface PersistedWorkflowState {
  mode?: WorkflowMode;
  phase?: WorkflowPhase;
  // Legacy field retained only for state migration.
  planningActive?: boolean;
  reviewedHash?: string;
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
  let planModeEverUsed = false;

  function readTodos(cwd: string): TodoItem[] {
    const content = readPlanFile(cwd);
    return content === undefined ? [] : extractTodoItems(content);
  }

  function persistState(): void {
    pi.appendEntry<PersistedWorkflowState>("plan-mode", {
      mode,
      phase,
      reviewedHash,
    });
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
    let todos: TodoItem[] = [];
    let planExists = false;
    try {
      const content = readPlanFile(ctx.cwd);
      planExists = content !== undefined;
      todos = content === undefined ? [] : extractTodoItems(content);
    } catch {
      // A separate error is shown when a command accesses the unsafe path.
    }

    const completedTodos = todos.filter((todo) => todo.completed).length;
    pi.events.emit(WORKFLOW_STATUS_EVENT, {
      source: "plan",
      mode,
      phase,
      planExists,
      completedTodos,
      totalTodos: todos.length,
    });

    const modeLabel =
      mode === "simple_plan"
        ? "MODE SIMPLE PLAN"
        : mode === "detailed_plan"
          ? "MODE DETAILED PLAN"
          : "MODE WORK";
    ctx.ui.setStatus(
      "workflow-mode",
      mode === "work" ? modeLabel : ctx.ui.theme.fg("accent", modeLabel),
    );

    // Weder Widget noch Footer zeigen die Todo-Anzahl. Beide Keys werden
    // explizit gelöscht, damit kein lingernder Wert im Footer stehen bleibt.
    ctx.ui.setWidget("plan-todos", undefined);
    ctx.ui.setStatus("plan-todos-count", undefined);
  }

  function invalidateReview(): void {
    reviewedHash = undefined;
    if (phase === "reviewed" || phase === "ready") phase = "draft";
  }

  function normalizeInterruptedPhase(ctx: ExtensionContext): void {
    if (
      phase !== "executing" &&
      phase !== "reviewing" &&
      phase !== "deciding"
    )
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

  function setWorkflowMode(
    target: WorkflowMode,
    ctx: ExtensionContext,
  ): boolean {
    if (!ctx.isIdle()) ctx.abort();
    normalizeInterruptedPhase(ctx);

    if (target !== "work") {
      if (!preparePlan(ctx)) return false;
      invalidateReview();
      phase = "draft";
    }

    mode = target;
    updateStatus(ctx);
    persistState();
    const label =
      target === "simple_plan"
        ? "Schnellplan"
        : target === "detailed_plan"
          ? "Architekturplan"
          : "Work-Modus";
    ctx.ui.notify(`${label} aktiv.`, "info");
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
        setWorkflowMode("detailed_plan", ctx);
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
      if (planExists) {
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
        ctx.ui.notify(`Keine Todos in ${PLAN_RELATIVE_PATH} gefunden.`, "info");
        return;
      }
      const list = todos
        .map(
          (todo) => `${todo.step}. ${todo.completed ? "✓" : "○"} ${todo.text}`,
        )
        .join("\n");
      ctx.ui.notify(`Plan-Fortschritt:\n${list}`, "info");
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
        if (!(await guardNewPlan(ctx))) return;
        setWorkflowMode(action.mode, ctx);
        return;
      }
      case "continue-plan": {
        const targetMode: WorkflowMode =
          mode === "simple_plan" || mode === "detailed_plan"
            ? mode
            : "detailed_plan";
        setWorkflowMode(targetMode, ctx);
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

  // Decision-Intake: vorgeschalteter Klär-Turn. Klärt über ask_user echte
  // Entscheidungen und endet mit einem [DECISION-BRIEF]-Block. Startet keine
  // Umsetzung und wechselt nicht nach /work.
  async function runDecisionIntake(ctx: ExtensionContext): Promise<void> {
    if (!ctx.hasUI || ctx.mode !== "tui") {
      ctx.ui.notify(
        "Decision-Intake benötigt den TUI-Modus (ask_user ist interaktiv nur dort verfügbar).",
        "warning",
      );
      return;
    }
    if (!ctx.isIdle()) ctx.abort();
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
        return;
      }
      if (decision === "archive-first") {
        try {
          const archivePath = archiveDecisionBrief(ctx.cwd);
          ctx.ui.notify(
            `Bisheriges Decision Brief archiviert: ${relative(ctx.cwd, archivePath)}`,
            "info",
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          ctx.ui.notify(
            `Archivierung fehlgeschlagen; Intake abgebrochen: ${message}`,
            "error",
          );
          return;
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
      return;
    }

    phase = "deciding";
    reviewedHash = undefined;
    updateStatus(ctx);
    persistState();

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

  // Wertet das Ende eines Decision-Turn aus: findet die Extension einen
  // [DECISION-BRIEF]-Block in der Antwort, schreibt sie ihn atomar nach
  // decision-brief.md (die Extension schreibt selbst, damit der Turn auf jeder
  // Permission-Stufe läuft). Ohne Block wird konservativ nichts gespeichert.
  async function handleDecisionTurnEnd(
    event: { messages: AgentMessage[] },
    ctx: ExtensionContext,
  ): Promise<void> {
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
      updateStatus(ctx);
      persistState();
    };

    if (!block) {
      resetPhase();
      ctx.ui.notify(
        "Kein Decision-Brief-Block erkannt; nichts gespeichert. Nutze /decide für einen neuen Versuch.",
        "warning",
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
    if (!(await guardNewPlan(ctx))) return;
    const targetMode = action === "quick" ? "simple_plan" : "detailed_plan";
    setWorkflowMode(targetMode, ctx);
    ctx.ui.notify(
      `${targetMode === "simple_plan" ? "Schnellplan" : "Architekturplan"} aktiv. Das Decision Brief wird als Kontext genutzt — beschreibe jetzt deine Aufgabe.`,
      "info",
    );
  }

  pi.events.on(WORKFLOW_MODE_REQUEST_EVENT, (request: WorkflowModeRequest) => {
    setWorkflowMode(request.mode, request.ctx);
  });

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
    description:
      "Decision-Intake starten (Optionen klären → Decision Brief)",
    handler: async (_args, ctx) => {
      await runDecisionIntake(ctx);
    },
  });

  pi.registerShortcut("ctrl+alt+p", {
    description: "Plan-Assistent öffnen",
    handler: async (ctx) => {
      await routePlan(ctx);
    },
  });

  pi.on("context", async (event) => {
    if (
      mode !== "work" ||
      phase === "executing" ||
      phase === "reviewing" ||
      phase === "deciding"
    )
      return;
    if (phase === "idle" && !planModeEverUsed) return;

    return {
      messages: event.messages.filter((message) => {
        const candidate = message as AgentMessage & { customType?: string };
        if (candidate.customType?.startsWith("plan-")) return false;
        if (candidate.role !== "user") return true;

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
    let brief: string | undefined;
    try {
      brief = readDecisionBrief(cwd);
    } catch {
      return "";
    }
    if (!brief) return "";
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
          content: `${PLAN_MODE_MARKER}
Du bist im ausführlichen Plan-Modus. Analysiere Kontext, Risiken, Optionen,
Abhängigkeiten und Umsetzungsschritte gründlich. Der Workflow-Modus verändert
keine Permissions; halte die aktuell gewählte Zugriffsstufe ein.

Führe die Aufgabe nicht aus. Schreibe ausschließlich den Plan nach
${PLAN_RELATIVE_PATH}, sofern die aktuelle Permission-Stufe dies erlaubt.

ENTSCHEIDUNGEN:
Wenn mehrere relevante Lösungen möglich sind, nutze vor dem finalen Plan ask_user.
Stelle pro Aufruf genau eine fokussierte Frage und biete 2–4 Optionen mit Vor-/Nachteilen und Empfehlung an.

PLANSTRUKTUR:
# Arbeitsplan: <Aufgabe>

## 1. Auftrag
## 2. Nicht-Ziele
## 3. Betroffene Bereiche
## 4. Risiken / Entscheidungen
## 5. Todos
- [ ] Konkreter Schritt
- [ ] Relevante Tests oder Checks ausführen
- [ ] Ergebnis prüfen

Pflicht sind nur Abschnitt 1 (Auftrag) und Abschnitt 5 (Todos, mindestens eine Checkbox). Abschnitte 2–4 sind empfohlen, aber nicht blockierend.

Schreibe den finalen Plan nach ${PLAN_RELATIVE_PATH} und stoppe danach.
Nächster Schritt: /work. Bei großen, riskanten oder architektonischen Änderungen optional vorher /review-plan.` +
            decisionBriefContext(ctx.cwd),
          display: false,
        },
      };
    }

    if (phase === "executing") {
      let todos: TodoItem[] = [];
      try {
        todos = readTodos(ctx.cwd).filter((todo) => !todo.completed);
      } catch {
        // The command path performs the user-facing error handling.
      }
      const todoList = todos
        .map((todo) => `${todo.step}. ${todo.text}`)
        .join("\n");
      return {
        message: {
          customType: "plan-execution-context",
          content: `${EXECUTING_PLAN_MARKER} — aktuelle Permission-Stufe bleibt aktiv

Offene Schritte:
${todoList || "Keine offenen Todos gefunden."}

Arbeite die Plan-Datei der Reihe nach ab. Markiere abgeschlossene Schritte mit [DONE:n].
Keine neuen Dependencies, Commits oder Pushes ohne ausdrückliche Freigabe.`,
          display: false,
        },
      };
    }
  });

  pi.on("turn_end", async (event, ctx) => {
    if (phase !== "executing" || !isAssistantMessage(event.message)) return;

    try {
      const current = readPlanFile(ctx.cwd);
      if (current === undefined) {
        phase = "draft";
        reviewedHash = undefined;
        ctx.ui.notify("Plan-Datei fehlt. Ausführung wurde gestoppt.", "error");
        updateStatus(ctx);
        persistState();
        return;
      }

      const completedSteps = extractDoneSteps(getTextContent(event.message));
      const result = applyDoneSteps(current, completedSteps);
      if (result.updated > 0) writePlanFileAtomic(ctx.cwd, result.content);

      const todos = extractTodoItems(result.content);
      if (todos.length > 0 && todos.every((todo) => todo.completed)) {
        try {
          const archivePath = archivePlanFile(ctx.cwd, "complete");
          phase = "idle";
          reviewedHash = undefined;
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
          const message =
            error instanceof Error ? error.message : String(error);
          ctx.ui.notify(
            `Alle Todos erledigt, Archivierung fehlgeschlagen: ${message}\nNutze /finish erneut.`,
            "warning",
          );
        }
      }
      updateStatus(ctx);
      persistState();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(
        `Todo-Status konnte nicht aktualisiert werden: ${message}`,
        "error",
      );
    }
  });

  pi.on("agent_end", async (event, ctx) => {
    if (phase === "deciding") {
      await handleDecisionTurnEnd(event, ctx);
      return;
    }

    if (phase === "reviewing") {
      const reviewText = getLatestAssistantText(event.messages);
      const outcome = getReviewOutcome(reviewText);

      try {
        const content = readPlanFile(ctx.cwd);
        const structureErrors =
          content === undefined
            ? [`Plan-Datei fehlt: ${PLAN_RELATIVE_PATH}`]
            : validatePlanStructure(content);

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
      persistState();
      return;
    }

    if (
      phase !== "draft" ||
      (mode !== "simple_plan" && mode !== "detailed_plan")
    )
      return;
    try {
      if (readPlanFile(ctx.cwd) !== undefined) {
        updateStatus(ctx);
        ctx.ui.notify(`Plan gespeichert → ${PLAN_RELATIVE_PATH}`, "info");
        // Bietet nach dem Schreiben/Verfeinern eines Plans sinnvolle nächste
        // Aktionen an — nicht-blockierend, keine automatische Ausführung.
        await offerPostPlanActions(ctx);
      }
    } catch {
      // Die zentrale Permission-Policy meldet unsichere Pfade separat.
    }
  });

  async function reviewPlan(ctx: ExtensionContext): Promise<void> {
    if (!ctx.isIdle()) ctx.abort();
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
    updateStatus(ctx);
    persistState();

    const structureErrors = validatePlanStructure(content);
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

  async function executePlan(ctx: ExtensionContext): Promise<void> {
    if (phase === "executing" && !ctx.isIdle()) {
      ctx.ui.notify("Plan wird bereits ausgeführt.", "warning");
      return;
    }
    setWorkflowMode("work", ctx);

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
        `Work Mode aktiv. Keine Plan-Datei gefunden: ${PLAN_RELATIVE_PATH}`,
        "info",
      );
      return;
    }
    const structureErrors = validatePlanStructure(content);
    if (structureErrors.length > 0) {
      phase = "draft";
      reviewedHash = undefined;
      updateStatus(ctx);
      persistState();
      ctx.ui.notify(
        `Planstruktur ist nicht mehr gültig:\n${structureErrors.join("\n")}`,
        "warning",
      );
      return;
    }

    if (reviewedHash && reviewedHash !== hashPlanContent(content)) {
      // Review ist reine Statusinformation und darf /work niemals blockieren.
      reviewedHash = undefined;
      if (phase === "reviewed") phase = "draft";
    }

    const todos = extractTodoItems(content);
    if (todos.every((todo) => todo.completed)) {
      phase = "ready";
      updateStatus(ctx);
      persistState();
      ctx.ui.notify(
        "Alle Plan-Todos sind bereits erledigt. Nutze /finish.",
        "info",
      );
      return;
    }

    phase = "executing";
    reviewedHash = undefined;
    mode = "work";
    updateStatus(ctx);
    persistState();

    pi.sendMessage(
      {
        customType: "plan-mode-execute",
        content: `${EXECUTING_PLAN_MARKER}

Plan-Datei: ${PLAN_RELATIVE_PATH}

${content}

Setze den Plan Schritt für Schritt um. Markiere abgeschlossene Schritte mit [DONE:n].`,
        display: true,
      },
      { triggerTurn: true },
    );
  }

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
      persistState();
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
      phase = keepPlanMode ? "draft" : "idle";
      reviewedHash = undefined;
      updateStatus(ctx);
      persistState();
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

  pi.events.on(PLAN_ACTION_REQUEST_EVENT, (request: PlanActionRequest) => {
    if (request.action === "choose") {
      void routePlan(request.ctx);
      return;
    }
    if (request.action === "decide") {
      void runDecisionIntake(request.ctx);
      return;
    }
    if (request.action === "work") {
      void executePlan(request.ctx);
      return;
    }
    if (request.action === "review") {
      void reviewPlan(request.ctx);
      return;
    }
    void runFinish(request.ctx);
  });

  pi.registerCommand("finish", {
    description: "Plan abschließen und sicher archivieren",
    handler: async (_args, ctx) => finishPlan(ctx),
  });

  pi.on("session_start", async (_event, ctx) => {
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
    } catch (error) {
      phase = "idle";
      mode = "work";
      reviewedHash = undefined;
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`Unsicherer Planpfad ignoriert: ${message}`, "error");
    }

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
      if (phase === "executing" || phase === "ready") {
        const todos = extractTodoItems(content);
        phase =
          todos.length > 0 && todos.every((todo) => todo.completed)
            ? "ready"
            : "executing";
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
  });
}
