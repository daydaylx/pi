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
  Theme,
} from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import { relative } from "node:path";
import {
  applyDoneSteps,
  archivePlanFile,
  ensurePlanDirectory,
  extractDoneSteps,
  extractTodoItems,
  getPlanPath,
  getReviewOutcome,
  hashPlanContent,
  isPlanFilePath,
  isSafeCommand,
  PLAN_RELATIVE_PATH,
  readPlanFile,
  redactCommand,
  validatePlanStructure,
  writePlanFileAtomic,
  type TodoItem,
} from "./utils.ts";
import {
  WORKFLOW_MODE_LABEL,
  WORKFLOW_STATUS_EVENT,
  type WorkflowPhase,
} from "../shared/workflow-status.ts";

const PLAN_MODE_TOOLS = [
  "read",
  "bash",
  "grep",
  "find",
  "ls",
  "ask_user",
  "write",
];

// Context markers: kept as constants so injection (below) and detection (in
// the "context" handler) can never drift apart, unlike two separately
// hand-typed copies of the same bracketed text.
const PLAN_MODE_MARKER = "[PLAN MODE ACTIVE]";
const PLAN_REVIEW_MARKER = "[PLAN REVIEW ACTIVE]";
const EXECUTING_PLAN_MARKER = "[EXECUTING PLAN]";

interface PersistedWorkflowState {
  phase?: WorkflowPhase;
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

// Begrenzt die kompakte Widget-Darstellung während /work: verhindert, dass
// die Todo-Liste wie ein zweites Hauptfenster über dem Editor wirkt.
const MAX_VISIBLE_TODOS = 5;
const MAX_TODO_LINE_LENGTH = 40;

function truncateTodoText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function buildTodoWidgetLines(todos: TodoItem[], theme: Theme): string[] {
  const completedTodos = todos.filter((todo) => todo.completed).length;
  const header = `Todos ${completedTodos}/${todos.length}`;

  if (completedTodos === todos.length) {
    return [header, "Alle erledigt → /finish"];
  }

  const openTodos = todos.filter((todo) => !todo.completed);
  const visibleTodos = openTodos.slice(0, MAX_VISIBLE_TODOS);
  const lines = visibleTodos.map(
    (todo) =>
      `${theme.fg("muted", "☐ ")}${truncateTodoText(todo.text, MAX_TODO_LINE_LENGTH)}`,
  );

  const hiddenCount = openTodos.length - visibleTodos.length;
  if (hiddenCount > 0) lines.push(`+ ${hiddenCount} offen`);

  return [header, ...lines];
}

export default function planModeExtension(pi: ExtensionAPI): void {
  let phase: WorkflowPhase = "idle";
  let planningActive = false;
  let reviewedHash: string | undefined;
  let normalModeTools: string[] | undefined;
  let planModeEverUsed = false;

  function readTodos(cwd: string): TodoItem[] {
    const content = readPlanFile(cwd);
    return content === undefined ? [] : extractTodoItems(content);
  }

  function persistState(): void {
    pi.appendEntry<PersistedWorkflowState>("plan-mode", {
      phase,
      planningActive,
      reviewedHash,
    });
  }

  function restoreNormalTools(): void {
    if (!normalModeTools) return;
    pi.setActiveTools(normalModeTools);
    normalModeTools = undefined;
  }

  function enablePlanningTools(ctx: ExtensionContext): boolean {
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

    if (!planningActive) {
      normalModeTools = pi.getActiveTools();
    }
    pi.setActiveTools(PLAN_MODE_TOOLS);
    planningActive = true;
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
    ctx.ui.setStatus(
      "workflow-mode",
      phase === "idle" ? undefined : WORKFLOW_MODE_LABEL[phase],
    );
    pi.events.emit(WORKFLOW_STATUS_EVENT, {
      source: "plan",
      phase,
      planningActive,
      planExists,
      completedTodos,
      totalTodos: todos.length,
    });

    const showTodoWidget =
      (phase === "executing" || phase === "ready") && todos.length > 0;

    ctx.ui.setWidget(
      "plan-todos",
      showTodoWidget ? buildTodoWidgetLines(todos, ctx.ui.theme) : undefined,
    );

    // Kompakte Todos-Anzeige im Footer, solange die ausführliche Checkliste
    // (oben) noch nicht angezeigt wird — vermeidet doppelte Anzeige derselben
    // Information sobald die Ausführung startet.
    ctx.ui.setStatus(
      "plan-todos-count",
      !showTodoWidget && todos.length > 0
        ? `Todos ${completedTodos}/${todos.length}`
        : undefined,
    );
  }

  function invalidateReview(): void {
    reviewedHash = undefined;
    if (phase === "reviewed" || phase === "ready") phase = "draft";
  }

  function togglePlanMode(ctx: ExtensionContext): void {
    if (phase === "executing" || phase === "reviewing") {
      ctx.ui.notify(
        phase === "executing"
          ? "Plan wird bereits ausgeführt."
          : "Plan-Review läuft bereits.",
        "warning",
      );
      return;
    }

    if (planningActive) {
      planningActive = false;
      restoreNormalTools();
      ctx.ui.notify("Plan-Modus pausiert. Plan-Datei bleibt erhalten.", "info");
    } else {
      if (!enablePlanningTools(ctx)) return;
      invalidateReview();
      phase = "draft";
      ctx.ui.notify(
        `Plan-Modus aktiv. Schreibzugriff nur auf ${PLAN_RELATIVE_PATH}.`,
        "info",
      );
    }
    updateStatus(ctx);
    persistState();
  }

  pi.registerFlag("plan", {
    description: "Start in plan mode (read-only except the plan file)",
    type: "boolean",
    default: false,
  });

  pi.registerCommand("plan", {
    description: "Plan-Modus umschalten",
    handler: async (_args, ctx) => togglePlanMode(ctx),
  });

  pi.registerCommand("plan-todos", {
    description: "Todos aus der aktuellen Plan-Datei anzeigen",
    handler: async (_args, ctx) => {
      try {
        const todos = readTodos(ctx.cwd);
        if (todos.length === 0) {
          ctx.ui.notify(
            `Keine Todos in ${PLAN_RELATIVE_PATH} gefunden.`,
            "info",
          );
          return;
        }
        const list = todos
          .map(
            (todo) =>
              `${todo.step}. ${todo.completed ? "✓" : "○"} ${todo.text}`,
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
    },
  });

  pi.registerShortcut(Key.ctrlAlt("p"), {
    description: "Plan-Modus umschalten",
    handler: async (ctx) => togglePlanMode(ctx),
  });

  pi.on("tool_call", async (event, ctx) => {
    if (!planningActive) return;

    if (event.toolName === "bash") {
      const command =
        typeof event.input.command === "string" ? event.input.command : "";
      if (!isSafeCommand(command)) {
        return {
          block: true,
          reason:
            "Plan-Modus: Befehl ist nicht als read-only freigegeben.\n" +
            `Befehl: ${redactCommand(command)}`,
        };
      }
    }

    if (event.toolName === "write" || event.toolName === "edit") {
      const input = event.input as Record<string, unknown>;
      const pathValues = [input.path, input.file_path].filter(
        (value): value is string => typeof value === "string",
      );
      const rawPath = pathValues.length === 1 ? pathValues[0] : undefined;
      if (!isPlanFilePath(rawPath, ctx.cwd)) {
        return {
          block: true,
          reason:
            "Plan-Modus: Schreibzugriff blockiert.\n" +
            `Erlaubt ist ausschließlich: ${PLAN_RELATIVE_PATH}\n` +
            `Versuchter Pfad: ${rawPath ?? "<fehlend oder mehrdeutig>"}`,
        };
      }
    }
  });

  pi.on("context", async (event) => {
    if (planningActive || phase === "executing" || phase === "reviewing")
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
            !content.includes(EXECUTING_PLAN_MARKER)
          );
        }
        if (Array.isArray(content)) {
          return !content.some(
            (block) =>
              block.type === "text" &&
              (block.text?.includes(PLAN_MODE_MARKER) ||
                block.text?.includes(PLAN_REVIEW_MARKER) ||
                block.text?.includes(EXECUTING_PLAN_MARKER)),
          );
        }
        return true;
      }),
    };
  });

  pi.on("before_agent_start", async (_event, ctx) => {
    if (phase === "reviewing") {
      return {
        message: {
          customType: "plan-review-context",
          content: `${PLAN_REVIEW_MARKER}
Prüfe den Plan auf Umsetzbarkeit, Vollständigkeit, Risiken, Tests und ungeklärte Entscheidungen.

Du darfst ausschließlich ${PLAN_RELATIVE_PATH} überarbeiten. Andere Schreibzugriffe sind verboten.
Wenn mehrere relevante Lösungen möglich sind, stelle vor der Freigabe mit ask_user genau eine fokussierte Frage pro Aufruf. Biete jeweils 2–4 Optionen mit Vor-/Nachteilen und einer Empfehlung an.

Ein Plan mit offenen entscheidungsrelevanten Fragen darf nicht freigegeben werden.
Beende den Review mit genau einem Marker:
- [PLAN-REVIEW:APPROVED]
- [PLAN-REVIEW:CHANGES-REQUIRED]`,
          display: false,
        },
      };
    }

    if (planningActive) {
      return {
        message: {
          customType: "plan-mode-context",
          content: `${PLAN_MODE_MARKER}
Du bist im read-mostly Plan-Modus.

ERLAUBT:
- read, bash (nur allowlisted), grep, find, ls, ask_user
- write ausschließlich auf ${PLAN_RELATIVE_PATH}

VERBOTEN:
- edit oder write auf andere Dateien
- verändernde Bash-Befehle
- selbstständiger Wechsel in den Arbeitsmodus

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
Nächster Schritt: /work. Bei großen, riskanten oder architektonischen Änderungen optional vorher /review-plan.`,
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
          content: `${EXECUTING_PLAN_MARKER} — Full tool access enabled

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
          planningActive = false;
          restoreNormalTools();
          ctx.ui.notify(
            "Plan geprüft und freigegeben. `/work` startet den unveränderten Plan (auch ohne erneuten Review möglich).",
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
            `Plan nicht freigegeben.${details}\nNach Korrektur erneut /review-plan ausführen.`,
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

    if (phase !== "draft" || !planningActive) return;
    try {
      if (readPlanFile(ctx.cwd) !== undefined) {
        updateStatus(ctx);
        ctx.ui.notify(
          `Plan gespeichert → ${PLAN_RELATIVE_PATH}\nNächster Schritt: /work. Optional: /review-plan für einen Deep-Review.`,
          "info",
        );
      }
    } catch {
      // The write guard already reports unsafe paths.
    }
  });

  async function reviewPlan(ctx: ExtensionCommandContext): Promise<void> {
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
      ctx.ui.notify(
        `Keine Plan-Datei gefunden: ${PLAN_RELATIVE_PATH}\nErstelle zuerst einen Plan mit /plan.`,
        "warning",
      );
      return;
    }
    if (phase === "executing") {
      ctx.ui.notify(
        "Ein laufender Plan kann nicht parallel geprüft werden.",
        "warning",
      );
      return;
    }
    if (!enablePlanningTools(ctx)) return;

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

  async function executePlan(ctx: ExtensionCommandContext): Promise<void> {
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
      ctx.ui.notify(
        `Keine Plan-Datei gefunden: ${PLAN_RELATIVE_PATH}`,
        "warning",
      );
      return;
    }
    if (phase === "executing") {
      ctx.ui.notify("Plan wird bereits ausgeführt.", "warning");
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

    const currentHash = hashPlanContent(content);
    const isReviewedAndUnchanged =
      !!reviewedHash && reviewedHash === currentHash;
    const isStaleReview = !!reviewedHash && reviewedHash !== currentHash;

    if (isStaleReview) {
      // Plan wurde reviewed, danach aber verändert — Hash-Schutz bleibt hier strikt.
      if (!ctx.hasUI) {
        ctx.ui.notify(
          "Plan wurde nach dem Review verändert. Führe /review-plan erneut aus (nicht-interaktiver Modus erlaubt keine Rückfrage).",
          "warning",
        );
        return;
      }
      const confirmed = await ctx.ui.confirm(
        "Plan wurde nach dem Review verändert.",
        "Ohne erneutes /review-plan trotzdem ausführen?",
      );
      if (!confirmed) {
        ctx.ui.notify(
          "Ausführung abgebrochen. Nutze /review-plan zur erneuten Freigabe.",
          "info",
        );
        return;
      }
    } else if (!isReviewedAndUnchanged) {
      // Nie reviewed — Hinweis, aber kein Block.
      ctx.ui.notify(
        "Kein Review durchgeführt. Führe direkt aus (optional: /review-plan für einen Deep-Review).",
        "info",
      );
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
    planningActive = false;
    restoreNormalTools();
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

  pi.registerCommand("finish", {
    description: "Plan abschließen und sicher archivieren",
    handler: async (_args, ctx) => {
      await ctx.waitForIdle();

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
        phase = "idle";
        planningActive = false;
        reviewedHash = undefined;
        restoreNormalTools();
        updateStatus(ctx);
        persistState();
        ctx.ui.notify("Keine Plan-Datei vorhanden.", "info");
        return;
      }

      const todos = extractTodoItems(content);
      const complete =
        todos.length > 0 && todos.every((todo) => todo.completed);
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
        const archivePath = archivePlanFile(
          ctx.cwd,
          complete ? "complete" : "incomplete",
        );
        phase = "idle";
        planningActive = false;
        reviewedHash = undefined;
        restoreNormalTools();
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
    },
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
      planningActive = persisted.planningActive ?? false;
      reviewedHash = persisted.reviewedHash;
    } else if (persisted) {
      phase = persisted.executing
        ? "executing"
        : persisted.enabled
          ? "draft"
          : "idle";
      planningActive = persisted.enabled ?? false;
    }

    let content: string | undefined;
    try {
      content = readPlanFile(ctx.cwd);
    } catch (error) {
      phase = "idle";
      planningActive = false;
      reviewedHash = undefined;
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`Unsicherer Planpfad ignoriert: ${message}`, "error");
    }

    if (content === undefined) {
      phase = "idle";
      planningActive = false;
      reviewedHash = undefined;
    } else {
      planModeEverUsed = true;
      if (phase === "idle") phase = "draft";
      if (phase === "reviewing") phase = "draft";
      if (
        phase === "reviewed" &&
        (!reviewedHash || hashPlanContent(content) !== reviewedHash)
      ) {
        // reviewedHash bleibt erhalten: executePlan() erkennt so auch nach
        // einem Sessionneustart noch "reviewed, aber seither verändert".
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
      planningActive = true;
      planModeEverUsed = true;
    }

    if (planningActive) {
      planningActive = false;
      if (!enablePlanningTools(ctx)) phase = "idle";
    }
    updateStatus(ctx);
  });
}
