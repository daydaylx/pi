# Globale Agent-Regeln

Diese Regeln gelten für alle Pi-Sitzungen.

## Schutzregeln (nicht verhandelbar)

- Commits, Pushes und Branch-Veröffentlichungen nur auf ausdrücklichen Auftrag
  ausführen.
- Neue Projektabhängigkeiten oder Systempakete nur nach vorheriger Zustimmung
  hinzufügen oder installieren.
- Änderungen auf den konkreten Auftrag begrenzen. Keine großflächigen
  Refactorings, Umbenennungen oder Formatierungen ohne eigenen Auftrag.
- Bestehende und nicht zum Auftrag gehörende Nutzeränderungen erhalten.
- Secrets, Zugangsdaten, Auth-Dateien, Umgebungsvariablen und SSH-Schlüssel
  weder offenlegen noch in Logs, Dokumentation oder Versionskontrolle
  übernehmen.
- Änderungen mit den relevanten Tests und statischen Prüfungen verifizieren;
  Fehler und nicht ausführbare Prüfungen ausdrücklich nennen.
- Den aktuell gewählten Workflow- und Permission-Modus respektieren. Diese
  Datei erzwingt keinen zusätzlichen Planmodus.

## Verhaltensregeln

- Projektbezogene Anweisungen ergänzen diese Regeln, heben aber Schutzregeln
  nicht stillschweigend auf.

## Subagenten-Delegation

- Die Entscheidung, eine Aufgabe an das `subagent`-Tool zu delegieren, trifft
  der Haupt-Agent eigenständig; eine ausdrückliche Nutzeranfrage ist nicht
  erforderlich.
- Delegieren bei klar abgrenzbaren Aufgaben, die zum Profil eines
  vorhandenen Agenten passen (`agents/*.md`), z. B.:
  - breite Codebase-Exploration über mehrere Dateien/Verzeichnisse → `scout`
  - Umsetzungsplan für eine komplexe Änderung → `planner`
  - Architektur-/Alternativenbewertung vor größeren Entscheidungen → `architect`
  - Umsetzung eines bereits abgenommenen, eng begrenzten Plans → `worker`
  - Review eines Diffs auf Bugs, Regressionen, Scope-Drift → `reviewer`
  - Sicherheitsaudit vor Abschluss riskanter Änderungen → `security-auditor`
  - kontrolliertes Ausführen von Tests/Static-Checks → `test-runner`
  - Dokumentationsabgleich mit dem aktuellen Code → `docs-auditor`
  - UI/UX-Review → `ui-reviewer`
  - Zweitmeinung zu riskanten Plänen oder widersprüchlichen Reviews → `oracle`
- Nicht delegieren bei trivialen, lokal begrenzten Aufgaben (Ein-Datei-Änderung,
  kurze Nachfrage, Typo-Fix) — der Prozessstart-Overhead übersteigt dort den
  Nutzen.
- Unabhängige Teilaufgaben parallel delegieren (`tasks[]`, max. 6 gleichzeitig),
  abhängige Arbeitsschritte sequenziell verketten (`chain[]`).
- Subagenten-Ergebnisse sind Vorschläge, keine Freigaben; der Haupt-Agent
  bewertet sie und trifft die finale Entscheidung.

### Delegations-Selbstcheck

Vor jedem nicht-trivialen Schritt kurz prüfen, damit Delegation nicht
versehentlich unterbleibt:

1. **Abgrenzbar?** Lässt sich der Schritt als eigenständige, überprüfbare
   Teilaufgabe abgrenzen?
2. **Profilpassend?** Passt er zum Profil eines vorhandenen Subagenten
   (`agents/*.md`)?

Beide ja → delegieren (parallel via `tasks[]`, sequenziell via `chain[]`).
Sonst selbst ausführen. Ergänzt die Regeln oben und hebt keine Schutzregel auf.
