import type { WorkflowMode } from "../shared/workflow-mode.ts";
import { PLAN_RELATIVE_PATH } from "./plan-file.ts";

export function planningPrompt(mode: Exclude<WorkflowMode, "work">): string {
  const structure =
    mode === "detailed_plan"
      ? `# Architekturplan\n\n## Ziel\n\n## Ausgangslage\n\n## Optionen\n\n## Empfehlung\n\n## Umsetzung\n\n## Risiken`
      : `# Plan\n\n## Ziel\n\n## Vorgehen\n\n## Betroffene Bereiche\n\n## Risiken oder offene Fragen`;
  return `[PI PLANMODUS]
Untersuche das Projekt, implementiere aber noch nichts. Schreibe oder ersetze
ausschließlich ${PLAN_RELATIVE_PATH}. Der Inhalt ist normaler Markdown und kein
technischer Vertrag: keine Metadaten, IDs, Schrittstatus oder Abschlusskriterien.
Die folgende Struktur ist eine Empfehlung, keine Validierungsregel:

${structure}`;
}

export function workPrompt(plan: string | undefined): string {
  if (!plan) {
    return "[PI WORKMODUS]\nArbeite normal im Projekt. Es ist kein Plan erforderlich.";
  }
  return `[PI WORKMODUS]
Der folgende Plan ist hilfreicher Kontext, aber kein technischer Vertrag.
Du darfst nachvollziehbar davon abweichen. Melde keine Step-IDs, Evidence oder
Workflow-Abschlüsse und starte keine Completion-Pipeline.

<plan>
${plan}
</plan>`;
}
