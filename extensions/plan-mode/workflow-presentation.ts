/** Stable prompt, status and transcript helpers for the plan workflow. */
import type { AgentMessage, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, TextContent } from "@earendil-works/pi-ai";
import type { WorkflowMode, WorkflowPhase } from "../shared/workflow-status.ts";
import type { AuroraWorkflowPhase } from "../aurora-ui/state.ts";
import { PLAN_RELATIVE_PATH } from "./utils.ts";

export const PLAN_MODE_MARKER = "[PLAN MODE ACTIVE]";
export const PLAN_REVIEW_MARKER = "[PLAN REVIEW ACTIVE]";
export const EXECUTING_PLAN_MARKER = "[EXECUTING PLAN]";
export const DECISION_INTAKE_MARKER = "[DECISION INTAKE ACTIVE]";

export const SUBAGENT_EXECUTING_REMINDER =
  "SUBAGENTEN:\nNutze das `subagent`-Tool bei Bedarf (siehe AGENTS.md → Subagenten-Delegation), z. B. für abgegrenzte Teilscopes oder Prüfungen nach Änderungen.";

export const SIMPLE_PLAN_PROMPT = `[EINFACHER PLAN]
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

export const MODE_THINKING: Record<WorkflowMode, ThinkingLevel> = {
  simple_plan: "medium",
  detailed_plan: "xhigh",
  work: "high",
};

export const MODE_LABEL: Record<WorkflowMode, string> = {
  simple_plan: "Schnellplan",
  detailed_plan: "Architekturplan",
  work: "Work-Modus",
};

export function auroraWorkflowPhase(
  phase: WorkflowPhase,
): AuroraWorkflowPhase {
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

export function isAssistantMessage(
  message: AgentMessage,
): message is AssistantMessage {
  return message.role === "assistant" && Array.isArray(message.content);
}

export function getTextContent(message: AssistantMessage): string {
  return message.content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

export function getLatestAssistantText(messages: AgentMessage[]): string {
  const latest = [...messages].reverse().find(isAssistantMessage);
  return latest ? getTextContent(latest) : "";
}

export function latestAssistantSucceeded(messages: AgentMessage[]): boolean {
  const latest = [...messages].reverse().find(isAssistantMessage);
  return latest?.stopReason === "stop";
}
