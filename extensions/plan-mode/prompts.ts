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
Weg existiert. Stößt du auf eine echte Entscheidung mit mehreren sinnvollen,
unterschiedlich riskanten Wegen, ist es ausdrücklich erwünscht, sie aktiv
über das Tool \`ask_user\` zu klären, statt sie nur im Optionen-Abschnitt zu
dokumentieren oder stillschweigend anzunehmen. Formuliere die Optionen dabei
in einfacher, für Laien verständlicher Sprache statt in Fachjargon, und
nenne immer eine klare Empfehlung mit Begründung. Nutze das Tool sparsam
(typischerweise 0–3 Fragen) und nur, wenn die Antwort den Plan tatsächlich
ändern würde. Die folgende Struktur ist eine Empfehlung,
keine Validierungsregel:

${structure}`;
}

/**
 * Work mode is Pi's normal state, so it needs no instruction of its own —
 * telling the model to "work normally" on every turn costs context and says
 * nothing. Only a plan handed over from a planning turn in this session is
 * worth injecting, and only once.
 */
export function workPrompt(plan?: string): string | undefined {
  if (!plan) return undefined;
  return `[PI WORKMODUS]

Ein gerade in dieser Sitzung erstellter Plan folgt einmalig als hilfreicher
Kontext. Der aktuelle User-Auftrag bleibt die Source of Truth; der Plan ist
kein technischer Vertrag und darf bei neuen Erkenntnissen nachvollziehbar
angepasst werden.

<plan>
${plan}
</plan>`;
}
