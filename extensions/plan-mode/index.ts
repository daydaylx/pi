/**
 * Plan workflow extension.
 *
 * Workflow: /plan -> /work (review-plan optional, finish meist automatisch)
 */

import type {
  AgentMessage,
  ThinkingLevel,
} from "@earendil-works/pi-agent-core";
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
  extractProgressBlock,
  extractTodoItems,
  getReviewOutcome,
  hashPlanContent,
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
import { runMenu, type MenuEntry } from "../shared/menu-ui.ts";
import { SHORTCUTS } from "../shared/shortcuts.ts";
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

// Gemeinsamer Subagenten-Hinweis für die Ausführungsphase: kept as a constant
// so the two injection sites (before_agent_start during "executing" and
// executePlan()) can't drift apart into two separately hand-typed copies.
const SUBAGENT_EXECUTING_REMINDER =
  "SUBAGENTEN:\nNutze das `subagent`-Tool bei Bedarf (siehe AGENTS.md → Subagenten-Delegation), z. B. für abgegrenzte Teilscopes oder Prüfungen nach Änderungen.";

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

// Thinking-Level folgt dem Workflow-Modus (Nutzerentscheidung): kompaktes
// Planen braucht kein Maximalbudget, Architekturanalysen schon. Wird nur bei
// einem echten Moduswechsel gesetzt; ein manueller Override über /thinking
// oder Ctrl+Shift+T gilt bis zum nächsten Wechsel.
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

/**
 * `"decide"` startet den Decision-Intake (transiente Phase) statt einen
 * persistenten WorkflowMode zu setzen; `openModeMenu()` filtert ihn vor dem
 * Aufruf von setWorkflowMode() heraus.
 */
type ModeMenuAction = WorkflowMode | "decide";

function buildModeMenu(
  currentMode: WorkflowMode,
  deciding: boolean,
): MenuEntry<ModeMenuAction>[] {
  return [
    {
      id: "mode-simple-plan",
      label: "Schnellplan",
      description:
        "Kleine Änderung planen. Schnell · wenig Risiko · keine Umsetzung ohne /work",
      value: "simple_plan",
      current: currentMode === "simple_plan",
    },
    {
      id: "mode-detailed-plan",
      label: "Architekturplan",
      description:
        "Größere Änderung sauber planen. Tief · strukturiert · sicher",
      value: "detailed_plan",
      current: currentMode === "detailed_plan",
    },
    {
      id: "mode-work",
      label: "Work-Modus",
      description:
        "Bestehenden Plan oder freie Aufgabe bearbeiten. Kontrolliert · explizit · nur mit aktuellen Permissions",
      value: "work",
      current: currentMode === "work",
    },
    {
      id: "mode-decide",
      label: "Optionen klären",
      description:
        "Vorentscheidung klären. 2–4 Optionen · Empfehlung · Decision Brief vor dem Plan",
      section: "Klärung",
      value: "decide",
      current: deciding,
    },
  ];
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
  let planModeEverUsed = false;
  // Ob die Plan-Datei vor dem aktuellen Agent-Turn bereits existierte. Steuert,
  // dass das "Nächster Schritt"-Menü nur nach dem Turn erscheint, der den Plan
  // erzeugt hat — nicht nach jedem Verfeinerungs-Turn.
  let planExistedBeforeTurn = false;

  function readTodos(cwd: string): TodoItem[] {
    const content = readPlanFile(cwd);
    return content === undefined ? [] : extractTodoItems(content);
  }

  function formatPlanTodoLines(todos: TodoItem[]): string[] {
    return todos.map(
      (todo) => `${todo.completed ? "[x]" : "[ ]"} T${todo.step}: ${todo.text}`,
    );
  }

  function persistState(): void {
    pi.appendEntry<PersistedWorkflowState>("plan-mode", {
      mode,
      phase,
      reviewedHash,
      planCreationMode,
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
    try {
      todos = readTodos(ctx.cwd);
    } catch {
      // A transient filesystem error must not hide the current workflow mode.
    }
    setTuiStatus(
      ctx,
      ZENTUI_STATUS_KEYS.workflow,
      workflowStatusValue(phase, mode, todos),
    );
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
    return true;
  }

  async function setWorkflowMode(
    target: WorkflowMode,
    ctx: ExtensionContext,
  ): Promise<boolean> {
    // Same-Mode-Auswahl im Idle ist ein No-op: ein versehentliches
    // Shift+Tab+Enter darf weder abbrechen noch neu initialisieren.
    if (target === mode && ctx.isIdle()) {
      ctx.ui.notify(`${MODE_LABEL[target]} ist bereits aktiv.`, "info");
      return true;
    }
    if (!(await confirmAbortActiveTurn(ctx))) return false;
    normalizeInterruptedPhase(ctx);

    if (target !== "work") {
      if (!preparePlan(ctx)) return false;
      invalidateReview();
      phase = "draft";
    }

    const modeChanged = target !== mode;
    mode = target;
    if (modeChanged) pi.setThinkingLevel(MODE_THINKING[target]);
    updateStatus(ctx);
    persistState();
    ctx.ui.notify(
      modeChanged
        ? `${MODE_LABEL[target]} aktiv. Thinking: ${MODE_THINKING[target]} (Modus-Default, ${SHORTCUTS.thinkingMenu.label} zum Ändern).`
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
        await setWorkflowMode(action.mode, ctx);
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
    updateStatus(ctx);
    persistState();
    return true;
  }

  // Decision-Intake: vorgeschalteter Klär-Turn. Klärt über ask_user echte
  // Entscheidungen und endet mit einem [DECISION-BRIEF]-Block. Startet keine
  // Umsetzung und wechselt nicht nach /work. Startet den Intake SOFORT
  // (triggerTurn) — genutzt von /decide, der /plan-Aktion (clarify) und dem
  // Ctrl+Shift+X-Eintrag.
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
    if (!(await guardNewPlan(ctx))) return;
    const targetMode = action === "quick" ? "simple_plan" : "detailed_plan";
    if (!(await setWorkflowMode(targetMode, ctx))) return;
    ctx.ui.notify(
      `${targetMode === "simple_plan" ? "Schnellplan" : "Architekturplan"} aktiv. Das Decision Brief wird als Kontext genutzt — beschreibe jetzt deine Aufgabe.`,
      "info",
    );
  }

  // Shift+Tab-Modusmenü: früher ein eigener Event-Rundweg über actions.ts +
  // shared/mode-menu.ts (WORKFLOW_MODE_REQUEST_EVENT /
  // PLAN_ACTION_REQUEST_EVENT). Da nur diese Extension Modi setzt, ruft das
  // Menü setWorkflowMode()/enterDecisionModeFromMenu() jetzt direkt auf.
  async function openModeMenu(ctx: ExtensionContext): Promise<void> {
    const selected = await runMenu<ModeMenuAction>(
      ctx,
      "Modus",
      buildModeMenu(mode, phase === "deciding"),
      { nonInteractiveHint: "Nutze /plan, um den Modus zu wählen." },
    );
    if (!selected) return;
    if (selected === "decide") {
      await enterDecisionModeFromMenu(ctx);
      return;
    }
    await setWorkflowMode(selected, ctx);
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
    handler: async (ctx) => openModeMenu(ctx),
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

Offene Schritte:
${todoList || "Keine offenen Todos gefunden."}

STOP-REGELN (verbindlich):
- Prüfe vor jedem Schritt, ob er noch zum Plan passt. Weiche nicht ab.
- Keine stillen Scope-Erweiterungen, keine neuen Features außerhalb des Plans.
- Keine neuen Dependencies, Commits oder Pushes ohne ausdrückliche Freigabe.
- Markiere einen Schritt nur als erledigt, wenn du einen konkreten Nachweis hast.
- Stoppe und melde einen Blocker, wenn Plan und Realität in Konflikt stehen.

${SUBAGENT_EXECUTING_REMINDER}

Melde am Ende des Turns Fortschritt als [PLAN-PROGRESS]-Block:
[PLAN-PROGRESS]
DONE:
- T1: erledigt, Nachweis: <kurze Beschreibung>

BLOCKED:
- T2: Grund: <kurze Beschreibung>
[/PLAN-PROGRESS]`,
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

      const text = getTextContent(event.message);
      const progressSteps = extractProgressBlock(text);
      const completedSteps =
        progressSteps !== undefined ? progressSteps : extractDoneSteps(text);
      const result = applyDoneSteps(current, completedSteps);
      if (result.updated > 0) writePlanFileAtomic(ctx.cwd, result.content);

      const todos = extractTodoItems(result.content);
      if (todos.length > 0 && todos.every((todo) => todo.completed)) {
        archiveCompletedPlan(ctx);
        return;
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
            : validatePlanStructure(content, planCreationMode);

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
        // Das "Nächster Schritt"-Menü erscheint nur nach dem Turn, der die
        // Plan-Datei neu erzeugt hat — Verfeinerungs-Turns bleiben menüfrei.
        if (!planExistedBeforeTurn) {
          planExistedBeforeTurn = true;
          if (mode === "simple_plan" || mode === "detailed_plan") {
            planCreationMode = mode;
            persistState();
          }
          await offerPostPlanActions(ctx);
        }
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

  // Archiviert ein vorhandenes Decision Brief zusammen mit dem Plan, damit es
  // nicht als veralteter Kontext in spätere, fremde Plan-Turns injiziert wird.
  // Fehler sind nicht fatal: das Plan-Archiv gilt unabhängig davon.
  function archiveBriefAlongsidePlan(ctx: ExtensionContext): void {
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
  function archiveCompletedPlan(ctx: ExtensionContext): void {
    try {
      const archivePath = archivePlanFile(ctx.cwd, "complete");
      archiveBriefAlongsidePlan(ctx);
      phase = mode !== "work" ? "draft" : "idle";
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
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(
        `Alle Todos erledigt, Archivierung fehlgeschlagen: ${message}\nNutze /finish erneut.`,
        "warning",
      );
    }
    updateStatus(ctx);
    persistState();
  }

  async function executePlan(ctx: ExtensionContext): Promise<void> {
    if (phase === "executing" && !ctx.isIdle()) {
      ctx.ui.notify("Plan wird bereits ausgeführt.", "warning");
      return;
    }
    if (!(await setWorkflowMode("work", ctx))) return;

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
    const structureErrors = validatePlanStructure(content, planCreationMode);
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

Setze den Plan Schritt für Schritt um. Die Todos sind als T1, T2, … nummeriert.

STOP-REGELN (verbindlich):
- Prüfe zuerst, ob der Plan noch zum aktuellen Repo-Zustand passt.
- Keine stillen Scope-Erweiterungen, keine neuen Features außerhalb des Plans.
- Keine neuen Dependencies, Commits oder Pushes ohne ausdrückliche Freigabe.
- Markiere einen Schritt nur als erledigt, wenn du einen konkreten Nachweis hast.
- Stoppe und melde einen Blocker, wenn Plan und Realität in Konflikt stehen.

${SUBAGENT_EXECUTING_REMINDER}

Schreibe am Ende des Turns einen [PLAN-PROGRESS]-Block zur Fortschrittsverfolgung
und einen [WORK-RESULT]-Block als lesbaren Ausführungsbericht:

[PLAN-PROGRESS]
DONE:
- T1: erledigt, Nachweis: <kurze Beschreibung>

BLOCKED:
- T2: Grund: <kurze Beschreibung>
[/PLAN-PROGRESS]

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
      persistState();
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
      archiveBriefAlongsidePlan(ctx);
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
    } catch (error) {
      phase = "idle";
      mode = "work";
      reviewedHash = undefined;
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

  pi.on("session_shutdown", async (_event, ctx) => {
    setTuiStatus(ctx, ZENTUI_STATUS_KEYS.workflow, undefined);
  });
}
