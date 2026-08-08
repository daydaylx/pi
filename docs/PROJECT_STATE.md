# Project State

## Aktuelle Arbeit

Die Verifikationssemantik ist geschärft, ohne die Architektur zu erweitern.
`verified` entsteht jetzt nur noch, wenn **alle deklarierten** `required`-Profile
für denselben Workspace-Fingerprint erfolgreich waren; ein Teillauf ergibt
`changed_unverified`. Ein bestätigter `recommended`-Fehlschlag kann nicht mehr
neben `verified` stehen — Tool-Ergebnis, Ledger und Footer leiten sich aus einer
einzigen Auswertung (`evaluateCheckRun`) ab. Der Ledger ist weiterhin ein
einziger flüchtiger Datensatz, zusätzlich an den Workspace-Root gebunden.
`project_check` meldet die akkumulierte Pflichtabdeckung und benennt offene
Profile; es führt nach wie vor nichts von selbst aus. Der Verifikationsstatus
wird jetzt tatsächlich in der Aurora-Footer gezeichnet — bisher wurde er
berechnet und verworfen. `.pi/verify.json` in diesem Repo deklariert genau ein
Pflichtprofil, das an `npm run verify` delegiert.

`evaluateCheckRun` wurde danach (Commit `0429e71`) noch einmal geschärft: ein
verschwundenes Binary bei einem bestätigten `recommended`-Fehlschlag setzt
zwar keinen neuen Block, darf den bestehenden aber auch nicht mehr
stillschweigend wegräumen — sonst hätte ein deinstalliertes Werkzeug
`checks_failed` unbemerkt wieder zu `verified` gemacht.

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

Die vollständige Prüfung `npm --prefix npm run verify` lief zu diesem
Zeitpunkt nur **lokal** erfolgreich — nicht CI-bestätigt. Tatsächlich war die
CI-Pflichtprüfung zu dieser Zeit auf jedem Lauf rot: ein standardmäßig
flacher Checkout (`fetch-depth: 1`) konnte den in
`benchmarks/harness/p4-manifest.json` gepinnten Referenz-Commit nicht
erreichen, wodurch `test:coverage` (und damit alles Nachfolgende in der
`&&`-Kette) auf jedem Push scheiterte, unabhängig von echter Codequalität.
Das „Quality-First Hardening"-Pass hat das behoben (`fetch-depth: 0` in
`.github/workflows/verify.yml`) und zusätzlich `test:runtime` — das eine
lokal gepatchte Runtime unter einem entwicklerspezifischen Pfad prüft — aus
der `verify`-Kette entfernt, damit ein CI-grüner Lauf tatsächlich etwas über
den Code aussagt statt über eine einzelne Maschine.

Derselbe Hardening-Pass hat außerdem einen technischen
Planmodus-Mutationsschutz ergänzt (`docs/decisions/012`), einen rein
diagnostischen `introduced`/`pre_existing`/`unknown`-Klassifikator für
fehlgeschlagene Checks (`extensions/setup-core/check-baseline.ts`) sowie den
dokumentierten Zusammenhang zwischen `project_check` und dem
Verifikations-Footer geschärft (`docs/verify-profiles.md`).

Vorhandene, nicht zu dieser Arbeit gehörende Änderungen in Runtime-Doku,
Runtime-Patches, Settings und Runtime-Tests wurden nicht verändert.

Nächste Schritte:

1. Mehrere kontrollierte Baseline- und Holdout-Läufe mit dem neuen Snapshot
   durchführen und Infrastrukturfehler referenzgebunden dokumentieren.
2. Trace-Metriken für Wiederholungen, No-Action-Turns und objektiven
   Fortschritt ergänzen, ohne Nudge- oder Blockadelogik.
3. Tool- und Kontextqualität für `verify`, `project_check`, Profilmetadaten
   und Fehlerklassen gezielt verbessern.
