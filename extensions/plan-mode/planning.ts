import {
  finalizePlanDocument,
  type FinalizedPlanDocument,
  type PlanKind,
} from "./plan-snapshot.ts";

export const PLAN_FILE_INSTRUCTION = ".agent/plans/current-plan.md";

const REQUIRED_SECTIONS = `## Ziel
## Nicht-Ziele
## Gewählte Lösung
## Annahmen
## Umsetzungsschritte
## Betroffene Bereiche
## Technischer Scope
## Änderungsregeln
## Risiken
## Verifikation
## Abschlusskriterien`;

export function planningPrompt(kind: PlanKind): string {
const architecture =
    kind === "detailed_plan"
      ? `
Dies ist ein Architekturplan. Ergänze direkt nach „Annahmen“ den Abschnitt
„## Bewertete Optionen“ mit genau 2 bis 4 realistischen Optionen und einer
verständlichen Bewertung aus Erklärung, Schwäche, Auswirkung und Eignung.
Wenn die Richtungsentscheidung nicht bereits ausdrücklich vom Nutzer getroffen
wurde, hole sie mit ask_user ein, bevor du die finale Plan-Datei schreibst. Die
gewählte Option muss mit „Gewählte Lösung“ konsistent sein.`
      : `
Dies ist ein Quick Plan. Erfinde keine künstlichen Alternativen und erstelle
keinen Decision Brief.`;
  return `[PI WORKFLOW: PLANUNG]
Erstelle oder überarbeite ausschließlich ${PLAN_FILE_INSTRUCTION}. Implementiere
noch nichts. Der Plan ist der verbindliche fachliche Snapshot für die spätere
Ausführung. Schreibe präzise, projektbezogen und ohne Fortschrittsmarkierungen.

Verwende exakt diese H2-Abschnitte in dieser Reihenfolge:
${REQUIRED_SECTIONS}
${architecture}

Regeln:
- Automatisiere keine echte Richtungsentscheidung still. Nutze ask_user nur,
  wenn Alternativen Aufwand, Qualität, Wartbarkeit, Risiko oder Bedienung
  tatsächlich unterschiedlich beeinflussen.
- „Technischer Scope“ enthält ausschließlich sichere, projekt-relative Pfade
  oder Globs, je Eintrag eine Zeile.
- „Umsetzungsschritte“ ist eine nummerierte Liste konkreter, prüfbarer Schritte.
- „Verifikation“ nennt ausführbare .pi/verify.json-Profil-IDs; im Agent-Setup
  sind zusätzlich typecheck und test verfügbar.
- „Abschlusskriterien“ ist beobachtbar und prüfbar.
- Metadaten und unsichtbare Step-IDs werden nach dem Turn deterministisch ergänzt.
- Beende den Turn, sobald der Plan vollständig gespeichert ist.`;
}

export function finalizePlanningTurn(
  content: string,
  kind: PlanKind,
  previousContent?: string,
): FinalizedPlanDocument {
  return finalizePlanDocument(content, kind, previousContent);
}

export function reviewPrompt(content: string): string {
  return `[PI WORKFLOW: PLAN-REVIEW]
Prüfe den Plan ausschließlich inhaltlich und formal. Implementiere nichts.
Ändere bei notwendigen Korrekturen ausschließlich ${PLAN_FILE_INSTRUCTION}.
Achte besonders auf Scope, Annahmen, Risiken, Verifikation und messbare
Abschlusskriterien.

<plan>
${content}
</plan>`;
}
