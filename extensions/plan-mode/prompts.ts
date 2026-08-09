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

export function workPrompt(plan?: string): string {
  const base = "[PI WORKMODUS]\nArbeite normal im Projekt. Es ist kein Plan erforderlich.";
  if (!plan) return base;
  return `${base}

Ein gerade in dieser Sitzung erstellter Plan folgt einmalig als hilfreicher
Kontext. Der aktuelle User-Auftrag bleibt die Source of Truth; der Plan ist
kein technischer Vertrag und darf bei neuen Erkenntnissen nachvollziehbar
angepasst werden.

<plan>
${plan}
</plan>`;
}
