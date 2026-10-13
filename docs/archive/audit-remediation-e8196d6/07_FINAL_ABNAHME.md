# Finale Abnahme – Meilenstein B

## Ziel

Gesamtpaket schließen, ohne die bereits bestandene Critical Remediation durch
unnötige Wiederholung oder zusätzliche Cleanup-Wellen zu gefährden.

## 1 – Traceability schließen

F-01–F-28 besitzen genau einen Endstatus in `08_TRACEABILITY_MATRIX.md`.

Für P0/P1 zulässig:

- `behoben`
- `widerlegt`
- `bewusst behalten` nur bei expliziter, belastbarer Produkt-/Sicherheits-
  Entscheidung

Für P2/P3 zusätzlich:

- `deferred` mit Grund, Rest-Risiko und Wiederaufnahme-Trigger

`offen`/`blockiert` sind in der finalen Abnahme nicht zulässig.

## 2 – Finale technische Prüfung

### Reproduzierbarkeit

`npm ci --prefix npm --engine-strict` nur erneut ausführen, wenn Lockfile,
Node/npm-Umgebung oder installierter Zustand seit der Baseline relevant
verändert wurde. Nicht ohne Grund dieselbe Installation wiederholen.

### Pflichtprofil

- `npm --prefix npm run verify`
- `npm --prefix npm test` nur separat, falls nicht vollständig in `verify`
  enthalten

Protocol-/Frontend-Server-Tests sollten jetzt über `verify` abgedeckt sein;
sie nicht noch einmal separat ausführen, außer zur Diagnose eines Fehlers.

### Zusätzliche fokussierte Regression

Nur für tatsächlich geänderte Hochrisikobereiche, insbesondere:

- Snapshot/Gates/Recovery;
- Verifier;
- Permission/Policy;
- Sessionmigration;
- Bridges, falls F-12 wirklich refactort wurde;
- Runtime, nur falls F-23 tatsächlich Code/Lockfile geändert hat.

## 3 – Produktnahe Critical-Szenarien kurz erneut prüfen

Nicht die komplette Baseline duplizieren. Mindestens die zentralen
Sicherheitsinvarianten:

- großer sicherheitsrelevanter Diff: ohne PASS blockiert, mit passender
  Evidenz erlaubt;
- Recovery bei großem gültigem Workspace funktioniert;
- Snapshotdefekt bleibt fail-closed und sichtbar;
- urteilsloser Verifier kann erneut laufen und deckt keinen Commit;
- headless/RPC und TUI bekommen fachlich denselben Verifikationsstatus;
- definierte Commitvarianten treffen das Gate;
- keine stale-PASS-Klasse durch F-10.

## 4 – Performance

F-10 Vorher/Nachherwerte in `09_STATUS_EVIDENZ.md` festhalten. Kein Zielwert
erfinden; entscheidend ist, dass redundante Arbeit reduziert wurde, ohne neue
Cache-/Konsistenzrisiken zu schaffen.

## 5 – Diff- und Verifierprüfung

Gesamtdiff gegen Base-SHA prüfen auf unbeabsichtigte Änderungen an:

- Benchmarks/Stage 2;
- Shift+Tab/Shortcuts;
- LSP-Lebenszyklus;
- Electron-Trust-/IPC-Grenze;
- Plan-Handoff;
- sonstigen nicht zum Audit gehörenden Bereichen.

Wenn geschützte Pfade betroffen sind: finaler Verifier-Lauf. Nur PASS bzw.
explizit einzeln bewertete nicht-blockierende Warnungen akzeptieren.

## Finales Abschlusskriterium

- Critical Checkpoint A bleibt erfüllt;
- alle 28 IDs klassifiziert;
- finales `verify` grün;
- Hauptsuite grün, soweit nicht bereits vollständig enthalten;
- keine Baseline gelockert;
- keine Benchmark-/Modellserie gestartet/verändert;
- keine ungewollte Bedienänderung;
- `git status --short` leer;
- kein Push/Merge ohne separaten Auftrag.
