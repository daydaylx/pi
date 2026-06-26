/**
 * Plan Mode Extension
 *
 * Read-only exploration mode for safe code analysis.
 * When enabled, only read-only tools are available.
 *
 * Features:
 * - /plan command or Ctrl+Alt+P to toggle
 * - Bash restricted to allowlisted read-only commands
 * - Extracts numbered plan steps from "Plan:" sections
 * - [DONE:n] markers to complete steps during execution
 * - Progress tracking widget during execution
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, TextContent } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import {
  extractTodoItems,
  isSafeCommand,
  isPlanFilePath,
  markCompletedSteps,
  redactCommand,
  type TodoItem,
} from "./utils.ts";

// "write" is listed so the agent can write the plan file; the tool_call guard restricts it to .agent/plans/current-plan.md only
const PLAN_MODE_TOOLS = [
  "read",
  "bash",
  "grep",
  "find",
  "ls",
  "questionnaire",
  "write",
];
let normalModeTools: string[] = [];

// Type guard for assistant messages
function isAssistantMessage(m: AgentMessage): m is AssistantMessage {
  return m.role === "assistant" && Array.isArray(m.content);
}

// Extract text content from an assistant message
function getTextContent(message: AssistantMessage): string {
  return message.content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

export default function planModeExtension(pi: ExtensionAPI): void {
  let planModeEnabled = false;
  let executionMode = false;
  let todoItems: TodoItem[] = [];

  const restoreNormalTools = (
    api: ExtensionAPI,
    ctx: ExtensionContext,
  ): void => {
    const tools = normalModeTools.length
      ? normalModeTools
      : api.getAllTools().map((tool) => tool.name);
    api.setActiveTools(tools);
    normalModeTools = [];
    ctx.ui.setStatus("plan-mode", undefined);
    ctx.ui.setWidget("plan-todos", undefined);
  };

  pi.registerFlag("plan", {
    description: "Start in plan mode (read-only exploration)",
    type: "boolean",
    default: false,
  });

  function updateStatus(ctx: ExtensionContext): void {
    // Footer status
    if (executionMode && todoItems.length > 0) {
      const completed = todoItems.filter((t) => t.completed).length;
      ctx.ui.setStatus(
        "plan-mode",
        ctx.ui.theme.fg("accent", `📋 ${completed}/${todoItems.length}`),
      );
    } else if (planModeEnabled) {
      ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("warning", "⏸ plan"));
    } else {
      ctx.ui.setStatus("plan-mode", undefined);
    }

    // Widget showing todo list
    if (executionMode && todoItems.length > 0) {
      const lines = todoItems.map((item) => {
        if (item.completed) {
          return (
            ctx.ui.theme.fg("success", "☑ ") +
            ctx.ui.theme.fg("muted", ctx.ui.theme.strikethrough(item.text))
          );
        }
        return `${ctx.ui.theme.fg("muted", "☐ ")}${item.text}`;
      });
      ctx.ui.setWidget("plan-todos", lines);
    } else {
      ctx.ui.setWidget("plan-todos", undefined);
    }
  }

  function togglePlanMode(ctx: ExtensionContext): void {
    planModeEnabled = !planModeEnabled;
    executionMode = false;
    todoItems = [];

    if (planModeEnabled) {
      normalModeTools = pi.getActiveTools();
      pi.setActiveTools(PLAN_MODE_TOOLS);
      ctx.ui.notify(`Plan mode enabled. Tools: ${PLAN_MODE_TOOLS.join(", ")}`);
    } else {
      restoreNormalTools(pi, ctx);
      ctx.ui.notify("Plan mode disabled. Previous tool selection restored.");
    }
    updateStatus(ctx);
    persistState();
  }

  function persistState(): void {
    pi.appendEntry("plan-mode", {
      enabled: planModeEnabled,
      todos: todoItems,
      executing: executionMode,
    });
  }

  pi.registerCommand("plan", {
    description: "Toggle plan mode (read-only exploration)",
    handler: async (_args, ctx) => togglePlanMode(ctx),
  });

  pi.registerCommand("plan-todos", {
    description: "Show current plan todo list",
    handler: async (_args, ctx) => {
      if (todoItems.length === 0) {
        ctx.ui.notify("No todos. Create a plan first with /plan", "info");
        return;
      }
      const list = todoItems
        .map(
          (item, i) => `${i + 1}. ${item.completed ? "✓" : "○"} ${item.text}`,
        )
        .join("\n");
      ctx.ui.notify(`Plan Progress:\n${list}`, "info");
    },
  });

  pi.registerShortcut(Key.ctrlAlt("p"), {
    description: "Toggle plan mode",
    handler: async (ctx) => togglePlanMode(ctx),
  });

  // Block destructive bash commands and all writes except the plan file
  pi.on("tool_call", async (event) => {
    if (!planModeEnabled) return;

    if (event.toolName === "bash") {
      const command = event.input.command as string;
      if (!isSafeCommand(command)) {
        return {
          block: true,
          reason: `Plan mode: command blocked (not allowlisted). Use /plan to disable plan mode first.\nCommand: ${redactCommand(command)}`,
        };
      }
    }

    if (event.toolName === "write" || event.toolName === "edit") {
      const rawPath = (event.input.path ??
        event.input.file_path ??
        "") as string;
      if (!isPlanFilePath(rawPath)) {
        return {
          block: true,
          reason: `Plan mode: Schreibzugriff blockiert.\nErlaubt ist ausschließlich: .agent/plans/current-plan.md\nVersuchter Pfad: ${rawPath}`,
        };
      }
    }
  });

  // Filter out stale plan mode context when not in plan mode
  pi.on("context", async (event) => {
    if (planModeEnabled) return;

    return {
      messages: event.messages.filter((m) => {
        const msg = m as AgentMessage & { customType?: string };
        if (msg.customType?.startsWith("plan-")) return false;
        if (msg.customType === "plan-complete") return false;
        if (msg.role !== "user") return true;

        const content = msg.content;
        if (typeof content === "string") {
          return (
            !content.includes("[PLAN MODE ACTIVE]") &&
            !content.includes("[EXECUTING PLAN")
          );
        }
        if (Array.isArray(content)) {
          return !content.some(
            (c) =>
              c.type === "text" &&
              ((c as TextContent).text?.includes("[PLAN MODE ACTIVE]") ||
                (c as TextContent).text?.includes("[EXECUTING PLAN")),
          );
        }
        return true;
      }),
    };
  });

  // Inject plan/execution context before agent starts
  pi.on("before_agent_start", async () => {
    if (planModeEnabled) {
      return {
        message: {
          customType: "plan-mode-context",
          content: `[PLAN MODE ACTIVE]
Du bist im Plan-Modus – einem read-mostly Analysemodus.

ERLAUBT:
- read, bash (nur allowlisted), grep, find, ls, questionnaire
- gh issue/pr/run/repo/workflow (nur lesende Subkommandos)
- write NUR auf: .agent/plans/current-plan.md

VERBOTEN:
- edit oder write auf alle anderen Dateien
- Destructive bash commands
- Selbstständiger Wechsel in Build Mode

AUFGABE:
1. Recherchiere den Kontext: lokale Dateien, Git-Status/-Log/-Diff, GitHub Issues/PRs/CI.
2. Erstelle die Plan-Datei mit dem write-Tool: .agent/plans/current-plan.md
   Falls das Verzeichnis fehlt: mkdir -p .agent/plans
3. Nutze exakt diese Struktur:

# Arbeitsplan: <Aufgabe>

## 1. Arbeitsauftrag
Klare Beschreibung, was gemacht werden soll.

## 2. Ziel
Was am Ende konkret funktionieren oder verbessert sein muss.

## 3. Nicht-Ziele
Was ausdrücklich nicht gemacht werden darf oder nicht Teil dieser Aufgabe ist.

## 4. Relevanter Kontext
Erkenntnisse aus lokalen Dateien, Git-Status, Git-Log, Git-Diff, GitHub Issues, PRs, CI, Dokumentation.

## 5. Betroffene Bereiche
Liste der voraussichtlich betroffenen Dateien, Komponenten, Module oder Konfigurationen.

## 6. Risiken und Schwachstellen
Mögliche Probleme, Seiteneffekte, technische Schulden oder unklare Annahmen.

## 7. Offene Fragen
Nur Fragen, die für eine saubere Umsetzung wirklich relevant sind.

## 8. Umsetzungsschritte / Todos
Konkrete, abhakbare Schritte:
* [ ] Schritt 1
* [ ] Schritt 2
* [ ] Relevante Tests oder Checks ausführen
* [ ] Ergebnis prüfen

## 9. Regeln für die spätere Umsetzung
* Die Umsetzung muss sich an diese Plan-Datei halten.
* Keine neuen Dependencies ohne Rückfrage.
* Kein Commit oder Push ohne ausdrückliche Freigabe.
* Bei unerwarteten Problemen stoppen und erklären.

## 10. Abschlussregeln / Definition of Done
Die Aufgabe gilt erst als abgeschlossen, wenn:
* [ ] alle Todos erledigt wurden
* [ ] relevante Tests oder Checks ausgeführt wurden
* [ ] keine unnötigen Dateien geändert wurden
* [ ] das Ergebnis kurz zusammengefasst wurde
* [ ] die temporäre Plan-Datei nach erfolgreicher Fertigstellung gelöscht wurde

4. Nach dem Schreiben: STOPPE. Gib aus: "Plan gespeichert → .agent/plans/current-plan.md | /go zum Ausführen"
   WECHSLE NICHT eigenständig in Build Mode.`,
          display: false,
        },
      };
    }

    if (executionMode && todoItems.length > 0) {
      const remaining = todoItems.filter((t) => !t.completed);
      const todoList = remaining.map((t) => `${t.step}. ${t.text}`).join("\n");
      return {
        message: {
          customType: "plan-execution-context",
          content: `[EXECUTING PLAN - Full tool access enabled]

Remaining steps:
${todoList}

Execute each step in order.
After completing a step, include a [DONE:n] tag in your response.`,
          display: false,
        },
      };
    }
  });

  // Track progress after each turn
  pi.on("turn_end", async (event, ctx) => {
    if (!executionMode || todoItems.length === 0) return;
    if (!isAssistantMessage(event.message)) return;

    const text = getTextContent(event.message);
    if (markCompletedSteps(text, todoItems) > 0) {
      updateStatus(ctx);
    }
    persistState();
  });

  // Handle plan completion and plan mode UI
  pi.on("agent_end", async (event, ctx) => {
    // Check if execution is complete
    if (executionMode && todoItems.length > 0) {
      if (todoItems.every((t) => t.completed)) {
        const completedList = todoItems.map((t) => `~~${t.text}~~`).join("\n");
        pi.sendMessage(
          {
            customType: "plan-complete",
            content: `**Plan Complete!** ✓\n\n${completedList}`,
            display: true,
          },
          { triggerTurn: false },
        );
        executionMode = false;
        todoItems = [];
        restoreNormalTools(pi, ctx);
        updateStatus(ctx);
        persistState(); // Save cleared state so resume doesn't restore old execution mode
      }
      return;
    }

    if (!planModeEnabled || !ctx.hasUI) return;

    // Try to extract todos from last assistant message
    const lastAssistant = [...event.messages]
      .reverse()
      .find(isAssistantMessage);
    if (lastAssistant) {
      const extracted = extractTodoItems(getTextContent(lastAssistant));
      if (extracted.length > 0) todoItems = extracted;
    }

    // Fallback: read todos from plan file (agent may have just written it without listing todos in chat)
    if (todoItems.length === 0) {
      try {
        const { readFileSync, existsSync } = await import("node:fs");
        const planPath = ".agent/plans/current-plan.md";
        if (existsSync(planPath)) {
          const planContent = readFileSync(planPath, "utf-8");
          const extracted = extractTodoItems(planContent);
          if (extracted.length > 0) todoItems = extracted;
        }
      } catch {
        // ignore fs errors silently
      }
    }

    updateStatus(ctx);
    ctx.ui.notify(
      "Plan gespeichert → .agent/plans/current-plan.md\nNutze /go zum Ausführen.",
      "info",
    );
  });

  async function executePlan(ctx: ExtensionContext): Promise<void> {
    const { readFileSync, existsSync } = await import("node:fs");
    const planPath = ".agent/plans/current-plan.md";

    if (!existsSync(planPath)) {
      ctx.ui.notify(
        `Keine Plan-Datei gefunden: ${planPath}\nErstelle zuerst einen Plan mit /plan`,
        "warning",
      );
      return;
    }

    const planContent = readFileSync(planPath, "utf-8");
    planModeEnabled = false;
    executionMode = true;
    restoreNormalTools(pi, ctx);
    updateStatus(ctx);

    pi.sendMessage(
      {
        customType: "plan-mode-execute",
        content: `[EXECUTING PLAN]\n\nPlan-Datei: ${planPath}\n\n${planContent}\n\nSetze den Plan Schritt für Schritt um. Markiere abgeschlossene Schritte mit [DONE:n].`,
        display: true,
      },
      { triggerTurn: true },
    );
  }

  pi.registerCommand("go", {
    description: "Plan ausführen (liest .agent/plans/current-plan.md)",
    handler: async (_args, ctx) => executePlan(ctx),
  });

  pi.registerCommand("work", {
    description: "Alias für /go – Plan ausführen",
    handler: async (_args, ctx) => executePlan(ctx),
  });

  pi.registerCommand("finish", {
    description: "Plan abschließen und Plan-Datei löschen",
    handler: async (_args, ctx) => {
      const { existsSync, unlinkSync } = await import("node:fs");
      const planPath = ".agent/plans/current-plan.md";

      if (existsSync(planPath)) {
        unlinkSync(planPath);
        ctx.ui.notify(`Plan-Datei gelöscht: ${planPath}`, "success");
      } else {
        ctx.ui.notify("Keine Plan-Datei vorhanden.", "info");
      }

      executionMode = false;
      todoItems = [];
      planModeEnabled = false;
      restoreNormalTools(pi, ctx);
      updateStatus(ctx);
      persistState();
    },
  });

  // Restore state on session start/resume
  pi.on("session_start", async (_event, ctx) => {
    if (pi.getFlag("plan") === true) {
      planModeEnabled = true;
    }

    const entries = ctx.sessionManager.getEntries();

    // Restore persisted state
    const planModeEntry = entries
      .filter(
        (e: { type: string; customType?: string }) =>
          e.type === "custom" && e.customType === "plan-mode",
      )
      .pop() as
      | { data?: { enabled: boolean; todos?: TodoItem[]; executing?: boolean } }
      | undefined;

    if (planModeEntry?.data) {
      planModeEnabled = planModeEntry.data.enabled ?? planModeEnabled;
      todoItems = planModeEntry.data.todos ?? todoItems;
      executionMode = planModeEntry.data.executing ?? executionMode;
    }

    // On resume: re-scan messages to rebuild completion state
    // Only scan messages AFTER the last "plan-mode-execute" to avoid picking up [DONE:n] from previous plans
    const isResume = planModeEntry !== undefined;
    if (isResume && executionMode && todoItems.length > 0) {
      // Find the index of the last plan-mode-execute entry (marks when current execution started)
      let executeIndex = -1;
      for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i] as { type: string; customType?: string };
        if (entry.customType === "plan-mode-execute") {
          executeIndex = i;
          break;
        }
      }

      // Only scan messages after the execute marker
      const messages: AssistantMessage[] = [];
      for (let i = executeIndex + 1; i < entries.length; i++) {
        const entry = entries[i];
        if (
          entry.type === "message" &&
          "message" in entry &&
          isAssistantMessage(entry.message as AgentMessage)
        ) {
          messages.push(entry.message as AssistantMessage);
        }
      }
      const allText = messages.map(getTextContent).join("\n");
      markCompletedSteps(allText, todoItems);
    }

    if (planModeEnabled) {
      pi.setActiveTools(PLAN_MODE_TOOLS);
    }
    updateStatus(ctx);
  });
}
