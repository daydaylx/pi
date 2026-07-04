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
  archivePlanFile,
  ensurePlanDirectory,
  extractDoneSteps,
  extractTodoItems,
  getReviewOutcome,
  hashPlanContent,
  PLAN_RELATIVE_PATH,
  readPlanFile,
  validatePlanStructure,
  writePlanFileAtomic,
  type TodoItem,
} from "./utils.ts";
import {
  WORKFLOW_MODE_REQUEST_EVENT,
  WORKFLOW_STATUS_EVENT,
  type WorkflowMode,
  type WorkflowModeRequest,
  type WorkflowPhase,
} from "../shared/workflow-status.ts";

// Context markers: kept as constants so injection (below) and detection (in
// the "context" handler) can never drift apart, unlike two separately
// hand-typed copies of the same bracketed text.
const PLAN_MODE_MARKER = "[PLAN MODE ACTIVE]";
const PLAN_REVIEW_MARKER = "[PLAN REVIEW ACTIVE]";
const EXECUTING_PLAN_MARKER = "[EXECUTING PLAN]";

// Persistenter Kontext für den „Einfachen Plan": keine Plan-Datei, keine
// Architektur-/Risiko-Blöcke und keine Änderung der Permission-Stufe.
const SIMPLE_PLAN_PROMPT = `[EINFACHER PLAN]
Erstelle einen schlichten, schnell einsetzbaren Plan für die aktuelle Aufgabe — geeignet für kleine bis mittlere Änderungen.

Vorgehen:
- Stelle maximal 2–5 gezielte Rückfragen, und nur, wenn sie für einen sauberen Plan wirklich nötig sind (nutze dazu ask_user).
- Verzichte auf ausführliche Architekturprüfung, lange Risiko-/Audit-Blöcke und eine separate Plan-Datei.

Gib danach einen kompakten Plan direkt im Chat aus mit genau diesen Punkten:
- Ziel
- Annahmen
- Betroffene Bereiche
- Konkrete Schritte
- Offene Punkte
- Empfehlung

Führe die Aufgabe nicht aus. Schreibe keine Plan-Datei, lege keine PLAN.md an
und bleibe knapp.`;

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

  function prepareDetailedPlan(ctx: ExtensionContext): boolean {
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
    if (phase !== "executing" && phase !== "reviewing") return;
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

    if (target === "detailed_plan") {
      if (!prepareDetailedPlan(ctx)) return false;
      invalidateReview();
      phase = "draft";
    }

    mode = target;
    updateStatus(ctx);
    persistState();
    const label =
      target === "simple_plan"
        ? "Einfacher Plan"
        : target === "detailed_plan"
          ? "Ausführlicher Plan"
          : "Work-Modus";
    ctx.ui.notify(`${label} aktiv.`, "info");
    return true;
  }

  // Router für /plan: die Auswahl ändert den Modus unmittelbar. Ohne
  // interaktive TUI wird der ausführliche Planmodus aktiviert.
  async function routePlan(ctx: ExtensionContext): Promise<void> {
    if (!ctx.hasUI || ctx.mode !== "tui") {
      setWorkflowMode("detailed_plan", ctx);
      return;
    }
    const choice = await ctx.ui.select("Plan-Variante wählen", [
      "Einfacher Plan",
      "Ausführlicher Plan",
    ]);
    if (!choice) return;
    if (choice === "Einfacher Plan") {
      setWorkflowMode("simple_plan", ctx);
    } else {
      setWorkflowMode("detailed_plan", ctx);
    }
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
    description: "Plan-Variante wählen: Einfach oder Ausführlich",
    handler: async (_args, ctx) => {
      await routePlan(ctx);
    },
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

  pi.registerShortcut("ctrl+alt+p", {
    description: "Plan-Variante wählen",
    handler: async (ctx) => {
      await routePlan(ctx);
    },
  });

  pi.on("context", async (event) => {
    if (mode !== "work" || phase === "executing" || phase === "reviewing")
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

    if (mode === "simple_plan") {
      return {
        message: {
          customType: "simple-plan-context",
          content: SIMPLE_PLAN_PROMPT,
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
          mode = "detailed_plan";
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

    if (phase !== "draft" || mode !== "detailed_plan") return;
    try {
      if (readPlanFile(ctx.cwd) !== undefined) {
        updateStatus(ctx);
        ctx.ui.notify(
          `Plan gespeichert → ${PLAN_RELATIVE_PATH}\nNächster Schritt: /work. Optional: /review-plan für einen Deep-Review.`,
          "info",
        );
      }
    } catch {
      // Die zentrale Permission-Policy meldet unsichere Pfade separat.
    }
  });

  async function reviewPlan(ctx: ExtensionCommandContext): Promise<void> {
    if (!setWorkflowMode("detailed_plan", ctx)) return;

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

  async function executePlan(ctx: ExtensionCommandContext): Promise<void> {
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
        phase = mode === "detailed_plan" ? "draft" : "idle";
        reviewedHash = undefined;
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
        const keepDetailedMode = mode === "detailed_plan";
        const archivePath = archivePlanFile(
          ctx.cwd,
          complete ? "complete" : "incomplete",
        );
        phase = keepDetailedMode ? "draft" : "idle";
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
      mode =
        persisted.mode ??
        (persisted.planningActive ? "detailed_plan" : "work");
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
      mode = "detailed_plan";
      planModeEverUsed = true;
    }

    if (mode === "detailed_plan" && phase === "idle") phase = "draft";
    if (mode === "detailed_plan" && !prepareDetailedPlan(ctx)) {
      mode = "work";
      phase = "idle";
    }
    updateStatus(ctx);
  });
}
