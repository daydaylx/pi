import type { WorkflowMode } from "../shared/workflow-mode.ts";
import { PLAN_RELATIVE_PATH } from "./plan-file.ts";

export function planningPrompt(mode: Exclude<WorkflowMode, "work">): string {
  const structure =
    mode === "detailed_plan"
      ? `# Architekturplan

## Ziel

## Nicht-Ziele
Nur wenn für die Aufgabe relevant.

## Ausgangslage und Grenzen

## Optionen
Nur wenn tatsächlich mehrere sinnvolle Lösungswege existieren.

## Empfehlung
Nur wenn zuvor echte Alternativen bewertet wurden.

## Umsetzung

## Verifikation

## Risiken`
      : `# Plan

## Ziel

## Vorgehen

## Betroffene Bereiche

## Verifikation

## Risiken oder offene Fragen`;
  return `[PI PLANMODUS]
Untersuche das Projekt, implementiere aber noch nichts. Schreibe oder ersetze
ausschließlich ${PLAN_RELATIVE_PATH}. Der Inhalt ist normaler Markdown und kein
technischer Vertrag: keine Metadaten, IDs, Schrittstatus oder Abschlusskriterien.
Verifikation beschreibt sinnvolle Prüfungen (Tests, Typecheck, Linter, konkrete
manuelle Prüfung, erwartetes Verhalten) als Teil der Planqualität, nicht als
technisches Gate. Erfinde keine künstlichen Optionen, wenn nur ein sinnvoller
Weg existiert. Die folgende Struktur ist eine Empfehlung, keine Validierungsregel:

${structure}`;
}

export function workPrompt(): string {
  return "[PI WORKMODUS]\nArbeite normal im Projekt. Es ist kein Plan erforderlich.";
}

export function goHandoffPrompt(plan: string): string {
  return `[PI WORKMODUS]
Setze den aktuellen Plan jetzt um. Der Plan ist hilfreicher Kontext und kein
technischer Vertrag. Du darfst bei neuen Erkenntnissen nachvollziehbar davon
abweichen. Melde keine Step-IDs, Evidence oder Workflow-Abschlüsse und starte
keine Completion-Pipeline.

<plan>
${plan}
</plan>`;
}
