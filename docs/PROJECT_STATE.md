# Project State

## Aktuelle Arbeit

Die Umsetzung von `pi-harness-hardening-v2` hat mit der gemeinsamen
Workspace-Snapshot-Basis begonnen. Neu ist
`benchmarks/harness/workspace-snapshot.mjs`: P4 und der allgemeine
Benchmark-Collector erfassen nun mit derselben versionierten Logik `HEAD`,
staged, unstaged und untracked Änderungen sowie Renames und Deletes. Das
Ergebnis enthält ausschließlich Pfade, Zustände und Fingerprints; Patches,
Dateiinhalte und absolute Pfade bleiben privat.

`collect-metrics.mjs` zählt nun auch staged und untracked Änderungen und gibt
den Snapshot als Teil des Diff-Ergebnisses aus. P4 verwendet denselben
Contract. Tests für den gemischten Git-Zustand und die Collector-Integration
sind in `benchmarks/harness/test/workspace-snapshot.test.mjs` ergänzt und in
den Gesamttest eingebunden. Die Ergebnis-Schema- und Benchmark-Dokumentation
beschreiben den zusätzlichen Snapshot.

Der Setup Core führt nun einen kleinen sitzungsgebundenen Ledger für Required
Project Checks. Bei `agent_settled` zeigt die bestehende Footer-Statuszeile
`clean`, `changed_unverified`, `verified`, `checks_failed` oder
`checks_unavailable`; `agent_end` wird nicht verwendet. Der Status ist
abschaltbar, dedupliziert, wird nur in interaktiven Oberflächen angezeigt und
führt nie automatisch einen Check aus. Der erfolgreiche Required-Check wird
an den vor seiner Ausführung erfassten Snapshot gebunden.

Die vollständige Prüfung `npm --prefix npm run verify` lief erfolgreich; sie
umfasste Formatierung, Typecheck, Dead-Code-Prüfung, alle Test-Suites,
Runtime-Patches und Audit.

Vorhandene, nicht zu dieser Arbeit gehörende Änderungen in Runtime-Doku,
Runtime-Patches, Settings und Runtime-Tests wurden nicht verändert.

Nächste Schritte:

1. Mehrere kontrollierte Baseline- und Holdout-Läufe mit dem neuen Snapshot
   durchführen und Infrastrukturfehler referenzgebunden dokumentieren.
2. Trace-Metriken für Wiederholungen, No-Action-Turns und objektiven
   Fortschritt ergänzen, ohne Nudge- oder Blockadelogik.
3. Tool- und Kontextqualität für `verify`, `project_check`, Profilmetadaten
   und Fehlerklassen gezielt verbessern.
