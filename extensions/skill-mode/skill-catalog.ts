/**
 * Skill-Katalog: Skill-Definitionen für den Skill-Launcher.
 *
 * Die Skills sind aus docs/skills/skill-catalog.md abgeleitet.
 * Die Prompts werden direkt im Code geführt; langfristig können sie über
 * SKILL.md-Dateien geladen werden (siehe skill-launcher-plan.md Phase 4).
 */

export type SkillExecutionMode = "info" | "analysis" | "plan" | "work";

export const EXECUTION_MODE_LABEL: Record<SkillExecutionMode, string> = {
  info: "Nur Informationen sammeln",
  analysis: "Analyse mit Risiken",
  plan: "Plan erstellen",
  work: "Umsetzung",
};

export const EXECUTION_MODE_DESCRIPTION: Record<SkillExecutionMode, string> = {
  info: "Sammelt Informationen, ohne Änderungen vorzunehmen. Read-only.",
  analysis: "Sammelt Informationen und bewertet sie mit Risiken.",
  plan: "Erstellt einen Arbeitsplan, ändert aber nichts am Projekt.",
  work: "Führt Änderungen durch. Nur mit expliziter Freigabe.",
};

export interface SkillDefinition {
  id: string;
  title: string;
  description: string;
  category: "analysis" | "planning" | "work" | "review" | "docs";
  defaultMode: SkillExecutionMode;
  readOnlyByDefault: boolean;
  requiresConfirmationForWrites: boolean;
  /** Prompt, der für die Skill-Ausführung injiziert wird. */
  systemPrompt: string;
}

function skill(
  id: string,
  title: string,
  description: string,
  category: SkillDefinition["category"],
  defaultMode: SkillExecutionMode,
  systemPrompt: string,
): SkillDefinition {
  const readOnlyByDefault = defaultMode !== "work";
  return {
    id,
    title,
    description,
    category,
    defaultMode,
    readOnlyByDefault,
    requiresConfirmationForWrites: defaultMode === "work",
    systemPrompt,
  };
}

export const SKILL_CATALOG: SkillDefinition[] = [
  skill(
    "repo-analyse",
    "Repository analysieren",
    "Sammelt Projektstruktur, Technologien, Risiken und Einstiegspunkte. Read-only.",
    "analysis",
    "info",
    `[SKILL: Repository analysieren]
Sammle Informationen über dieses Repository, ohne Änderungen vorzunehmen.

Vorgehen:
- Projektstruktur und Verzeichnisse überblicken.
- Haupttechnologien, Sprachen und Frameworks identifizieren.
- Einstiegspunkte (main, App-Klasse, Config) finden.
- Wichtige Dateien (README, Build-Konfiguration, Dependencies) lokalisieren.
- Architekturmuster erkennen (MVC, MVVM, Clean Architecture, …).
- Technische Risiken und Auffälligkeiten notieren.
- Keine Änderungen, keine Refactorings, keine automatischen Fixes.

Ausgabeformat:
## Repository-Überblick
## Haupttechnologien
## Einstiegspunkte
## Wichtige Dateien
## Risiken
## Offene Fragen
## Nächste sinnvolle Prüfungen`,
  ),

  skill(
    "git-check",
    "Git / Issues / Branches prüfen",
    "Prüft Branch, Remote, offene Änderungen, Issues und PRs.",
    "analysis",
    "info",
    `[SKILL: Git / Issues / Branches prüfen]
Prüfe den Git-Zustand dieses Repositories, ohne Änderungen vorzunehmen.

Prüfungen:
- Aktueller Branch und Remote-Zustand (ahead/behind).
- Uncommitted Changes, staged/unstaged Files.
- Offene Issues und Pull Requests (falls via gh CLI oder API erreichbar).
- Letzte Commits und potenzielle Konflikte.
- Keine automatischen Merges, Force Push, Branch-Löschung oder Commits.

Ausgabeformat:
## Git-Zustand
## Remote-Zustand
## Offene Änderungen
## Branches
## Issues / PRs
## Risiken
## Empfehlung`,
  ),

  skill(
    "doc-diff",
    "Dokumenten-Diff prüfen",
    "Vergleicht Dokumente und erkennt Widersprüche, Dopplungen, Veraltetes.",
    "docs",
    "info",
    `[SKILL: Dokumenten-Diff prüfen]
Vergleiche relevante Dokumente im Projekt und erkenne inhaltliche Unterschiede.

Prüfungen:
- Geänderte, entfernte und neue Abschnitte zwischen Dokumentversionen.
- Widersprüchliche Regeln oder Aussagen.
- Doppelte Inhalte in verschiedenen Dokumenten.
- Veraltete Pfade, Befehle oder Verweise.
- Fehlende Querverweise.
- Keine blinde Zusammenführung, kein Löschen ohne Freigabe.

Ausgabeformat:
## Vergleich
## Neue Inhalte
## Entfernte Inhalte
## Widersprüche
## Veraltete Inhalte
## Empfohlene Korrekturen
## Nicht automatisch entscheiden`,
  ),

  skill(
    "agent-docs",
    "Agent-Dokumente einrichten oder prüfen",
    "Prüft oder erstellt Agent-Dokumentation für Coding-Agenten.",
    "docs",
    "analysis",
    `[SKILL: Agent-Dokumente einrichten oder prüfen]
Prüfe die vorhandene Agent-Dokumentation und schlage Verbesserungen vor.

Zu prüfende Dateien:
- AGENTS.md, CLAUDE.md, GEMINI.md
- .codex/AGENTS.md, .claude/CLAUDE.md, .pi/AGENTS.md
- docs/agent-workflow.md, docs/project-rules.md, docs/verification.md

Prüfmodus: Read-only als Standard. Keine Änderungen ohne Freigabe.

Vorgehen:
- Alle relevanten Agent-Dokumente finden.
- Jedes Dokument nach Aktualität, Relevanz, Widersprüchen bewerten.
- Zielstruktur vorschlagen (AGENTS.md + docs/…).
- Veraltete Dokumente als Archiv-Kandidaten markieren.
- Widersprüche zwischen Dokumenten sichtbar machen.
- Keine Änderungen ohne explizite Nutzerfreigabe.

Ausgabeformat:
# Agent-Dokumente Prüfung
## Gefundene Dokumente
| Datei | Zweck | Zustand | Empfehlung |
## Wichtige Inhalte
## Widersprüche
## Veraltete oder doppelte Dokumente
## Fehlende Dokumente
## Empfohlene Zielstruktur
## Konkrete nächste Schritte
## Änderungen mit Freigabepflicht`,
  ),

  skill(
    "bug-triage",
    "Bug-Triage",
    "Sammelt Informationen zu einem Fehler und grenzt die Ursache ein.",
    "analysis",
    "analysis",
    `[SKILL: Bug-Triage]
Sammle Informationen zu dem gemeldeten Fehler und grenze die Ursache ein.

Vorgehen:
- Fehlerbild genau beschreiben (Logs, Stacktraces, Screenshots).
- Reproduktionsschritte identifizieren oder rekonstruieren.
- Relevante Dateien und Code-Stellen lokalisieren.
- Wahrscheinliche Ursachen eingrenzen, alternative Ursachen ausschließen.
- Keine Sofort-Fixes ohne Diagnose, keine großen Refactorings.

Ausgabeformat:
## Fehlerbild
## Reproduktion
## Relevante Dateien
## Wahrscheinliche Ursache
## Ausschlüsse
## Risiken
## Fix-Optionen`,
  ),

  skill(
    "test-ci",
    "Test- und CI-Prüfung",
    "Prüft Tests, Build, Linting und CI-Zustand.",
    "review",
    "analysis",
    `[SKILL: Test- und CI-Prüfung]
Prüfe Testabdeckung, Build-Status, Linting-Ergebnisse und CI-Zustand.

Vorgehen:
- Testbefehle identifizieren (npm test, cargo test, ./gradlew test, …).
- Tests ausführen und Ergebnisse sammeln.
- Build-Konfiguration und letzte Build-Ergebnisse prüfen.
- Linting-Regeln und -Ergebnisse sichten.
- Fehlende oder instabile Tests identifizieren.
- Keine automatische Testlöschung, kein CI-Umbau ohne Freigabe.

Ausgabeformat:
## Testbefehle
## Ergebnis
## Fehlende Tests
## Instabile Tests
## CI-Risiken
## Empfehlung`,
  ),

  skill(
    "ui-ux-review",
    "UI-/UX-Review",
    "Bewertet UI, Layout, Bedienbarkeit und visuelle Probleme.",
    "review",
    "analysis",
    `[SKILL: UI-/UX-Review]
Bewerte die Benutzeroberfläche auf Bedienbarkeit und visuelle Qualität.

Prüfungen:
- Größte Schwächen im aktuellen UI identifizieren.
- Bedienprobleme und unintuitive Abläufe finden.
- Visuelle Dominanz und Ablenkungen bewerten.
- Inkonsistenzen in Layout, Farben, Typografie aufdecken.
- Konkrete Verbesserungen mit Begründung vorschlagen.
- Keine reinen Geschmacksänderungen ohne Ziel.

Ausgabeformat:
## Größte Schwächen
## Bedienprobleme
## Visuelle Dominanz
## Inkonsistenzen
## Konkrete Verbesserungen
## Priorität`,
  ),

  skill(
    "prompt-compiler",
    "Prompt-Compiler",
    "Wandelt grobe Aufgaben in klare Arbeitsaufträge für Coding-Agenten um.",
    "planning",
    "plan",
    `[SKILL: Prompt-Compiler]
Wandle die beschriebene Aufgabe in einen präzisen Prompt für einen Coding-Agenten um.

Ziel-Agent: Claude Code, Codex, Pi Agent, Qwen Code oder ähnliche.

Standard-Aufbau:
- Rolle: Welche Perspektive soll der Agent einnehmen?
- Ziel: Was genau soll erreicht werden?
- Nicht-Ziele: Was soll explizit nicht passieren?
- Kontext: Relevante Hintergrundinformationen.
- Vorgehen: Schritt-für-Schritt-Anleitung.
- Änderungsregeln: Was darf/soll geändert werden, was nicht?
- Verifikation: Wie wird das Ergebnis geprüft?
- Ausgabeformat: Welche Struktur soll die Antwort haben?
- Abschlusskriterien: Woran ist die Fertigstellung erkennbar?
- Schwierigkeiten: X/10 | Thinking: low/medium/high/xhigh

Erstelle einen vollständigen Prompt mit allen Abschnitten.`,
  ),

  skill(
    "release-changelog",
    "Release / Changelog",
    "Sammelt Änderungen seit letztem Stand und erstellt Release Notes.",
    "planning",
    "analysis",
    `[SKILL: Release / Changelog]
Sammle Änderungen seit dem letzten Release und erstelle eine Zusammenfassung.

Vorgehen:
- Letzten Release-Tag oder Versionsstand ermitteln.
- Commits seit letztem Stand sammeln (git log).
- Änderungen in Kategorien gruppieren (Features, Fixes, Breaking Changes).
- Risiken und Migration-Hinweise identifizieren.
- Keine automatische Versionserhöhung, kein Deployment ohne Freigabe.

Ausgabeformat:
## Änderungen
## Fixes
## Risiken
## Breaking Changes
## Migration
## Release-Checkliste`,
  ),

  skill(
    "security-audit",
    "Security / Dependency Audit",
    "Prüft Dependencies, Secrets, Permissions und Sicherheitsprobleme.",
    "review",
    "analysis",
    `[SKILL: Security / Dependency Audit]
Prüfe das Projekt auf einfache Sicherheitsprobleme und Dependency-Risiken.

Prüfungen:
- Dependency-Risiken (bekannte CVEs, veraltete Pakete).
- Secrets und Tokens im Code (API-Keys, Passwörter, Private Keys).
- Berechtigungen (Manifest-Permissions, Scope-Creep).
- Netzwerk- und API-Sicherheit (ungeprüfte Endpoints).
- Keine aggressiven Exploits, keine Angriffe auf fremde Systeme.

Ausgabeformat:
## Dependency-Risiken
## Secrets / Tokens
## Berechtigungen
## Netzwerk / API
## Kritische Findings
## Empfohlene Maßnahmen`,
  ),
];

/** Skill anhand der ID finden. */
export function findSkill(id: string): SkillDefinition | undefined {
  return SKILL_CATALOG.find((s) => s.id === id);
}
