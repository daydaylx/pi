import type { WorkflowMode } from "../shared/workflow-mode.ts";
import { PLAN_WRITE_TOOL_NAME } from "./plan-tool.ts";
import { requiredSections } from "./plan-quality.ts";

/**
 * The two planning prompts.
 *
 * They differ in more than their headings now: the sections listed as required
 * are the same ones `plan-quality.ts` enforces when `plan_write` runs, so a
 * Schnellplan and an Architekturplan really are held to different bars rather
 * than to the same bar with different words above it. Sections that only apply
 * sometimes (Optionen, Empfehlung, Migration) stay explicitly optional so the
 * requirement cannot manufacture the fake alternatives the prompt warns about.
 */
function sectionList(mode: Exclude<WorkflowMode, "work">): string {
  return requiredSections(mode)
    .map((section) => `## ${section}`)
    .join("\n\n");
}

const SHARED_RULES = `Untersuche das Projekt, implementiere aber noch nichts. Halte das Ergebnis
ausschließlich über das Tool \`${PLAN_WRITE_TOOL_NAME}\` fest; es gibt keine
Plandatei im Projektverzeichnis, die du selbst schreiben müsstest oder dürftest.

Der Plan ist normaler Markdown und kein technischer Vertrag: keine Metadaten,
IDs oder Schrittstatus. "Verifikation" beschreibt sinnvolle Prüfungen (Tests,
Typecheck, Linter, konkrete manuelle Prüfung, erwartetes Verhalten) als Teil der
Planqualität, nicht als technisches Gate.

Erfinde keine künstlichen Optionen, wenn nur ein sinnvoller Weg existiert.
Stößt du auf eine echte Entscheidung mit mehreren sinnvollen, unterschiedlich
riskanten Wegen, kläre sie aktiv über das Tool \`ask_user\`, statt sie nur zu
dokumentieren oder stillschweigend anzunehmen. Formuliere die Optionen in
einfacher, für Laien verständlicher Sprache und nenne immer eine klare
Empfehlung mit Begründung. Nutze das Tool sparsam (typischerweise 0–3 Fragen)
und nur, wenn die Antwort den Plan tatsächlich ändern würde.

Der Plan wird nach diesem Turn nicht automatisch ausgeführt. Die Nutzerin/der
Nutzer entscheidet ausdrücklich, ob er umgesetzt wird.`;

export function planningPrompt(mode: Exclude<WorkflowMode, "work">): string {
  const detailed = mode === "detailed_plan";
  const expectations = detailed
    ? `Dies ist ein Architekturplan. Jeder der folgenden Abschnitte muss eigenen
Inhalt tragen, sonst wird der Plan abgelehnt:

${sectionList(mode)}

Zusätzlich gilt:
- "Ausgangslage" nennt konkrete Dateien, Symbole oder Schnittstellen, die du
  tatsächlich gelesen hast — keine Vermutungen.
- "Annahmen" trennt Belegtes von Unsicherem und benennt offene Fragen.
- "Umsetzung" gliedert die Arbeit in mindestens zwei logisch getrennte Phasen
  oder Schritte.
- "Abhängigkeiten" nennt die Reihenfolge und was worauf wartet.
- "Abschlusskriterien" sagt pro Phase, woran ihr Abschluss erkennbar ist.
- "Verifikation" nennt konkrete Prüfungen mit erwartetem Ergebnis.
- "Risiken" deckt Kompatibilität, Sicherheit, Daten und Betrieb ab.

Optional und nur wenn wirklich zutreffend: "Optionen" mit echten Alternativen,
"Empfehlung" mit Begründung, sowie eine Migrations- und Rückfallstrategie.`
    : `Dies ist ein Schnellplan: leichtgewichtig, ohne Phasenbürokratie und ohne
künstliche Alternativen. Jeder der folgenden Abschnitte muss eigenen Inhalt
tragen, sonst wird der Plan abgelehnt:

${sectionList(mode)}

"Vorgehen" beschreibt das kleinste sinnvolle Vorgehen, "Betroffene Bereiche"
die tatsächlich berührten Dateien oder Module, "Verifikation" eine konkrete
Prüfung und "Risiken" die wesentlichen Risiken oder offenen Fragen.`;
  return `[PI PLANMODUS]
${SHARED_RULES}

${expectations}`;
}
