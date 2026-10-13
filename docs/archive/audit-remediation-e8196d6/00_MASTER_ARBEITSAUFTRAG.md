# Master-Arbeitsauftrag – optimierte Fassung

## Ziel

Arbeite das Audit `docs/PI_COMPLEXITY_ERROR_ANALYSIS.html` kontrolliert ab,
ohne aus der Remediation ein neues Architekturprojekt zu machen.

Prioritäten:

1. bestätigte P0/P1-Fehler sicher schließen;
2. fehlende Prüfabdeckung schließen;
3. unnötige Komplexität nur entfernen, wenn Netto-Komplexität tatsächlich
   sinkt;
4. unsichere Befunde erst belegen;
5. Entscheidungen mit Produkt-/Sicherheitswirkung explizit dokumentieren;
6. Stage 2, Benchmarks und Modellläufe unberührt lassen.

## Nicht-Ziele

- kein Neustart oder Fortsetzen einer Benchmark-/Stage-2-Serie;
- keine Modellläufe;
- keine grundlegende Neuausrichtung von CLI/TUI oder GUI;
- keine Änderung an Shift+Tab, vorhandenen Shortcuts oder deren Bedienlogik;
- keine beiläufige LSP-, Electron-IPC-/Sandbox- oder Plan-Handoff-Neuarchitektur;
- keine Coverage-/Snapshot-/Testbaseline lockern, um Tests grün zu machen;
- kein Push, Merge, Release oder Tag ohne gesonderten Auftrag.

## Ausgangsstand

- Referenz-HEAD: `e8196d60d95afead4aa0487f941deffa736e47a8`
- Audit-Commit: `e6db405b6cb3f17dc6f262375c5152a721c8cca6`
- analysierter Produktcode: `4563fad1937ed838a4824777d6c6a25298349f27`

Zu Beginn aktuelle Commitfolge prüfen. Wurde seit dem Referenzstand Produktcode
geändert, betroffene F-IDs gegen den heutigen Stand neu bewerten.

## Verbindliche Sicherheitsregeln

- Sicherheitsgrenzen dürfen bei internen Fehlern nie still permissiver werden.
- Snapshotfehler müssen über einen gemeinsamen fachlichen Vertrag laufen;
  Aufrufer dürfen denselben Defekt nicht gegensätzlich interpretieren.
- Ein fehlender/defekter Snapshot darf niemals als Verifier-PASS-Evidenz
  zählen.
- Unbekannte Verifier-Ausgaben dürfen nicht als PASS umgedeutet werden.
- Keine generische Abstraktion darf sicherheitsrelevante Defaults verstecken.
- Produktnahe Tests haben Vorrang vor Tests ausschließlich interner Helfer.

## Arbeitsmodell pro Änderung

1. aktuellen Produktionspfad und Auditannahme bestätigen;
2. reproduzieren oder statisch vollständig belegen;
3. fokussierte Erwartungsmatrix/Regression festhalten;
4. kleinstmögliche fachliche Änderung umsetzen;
5. fokussierte Tests ausführen;
6. Diff auf Scope, fail-open, stille Catches und neue Duplikate prüfen;
7. `08_TRACEABILITY_MATRIX.md` aktualisieren;
8. einen **fachlich unabhängig rückrollbaren** Commit erstellen.

Kein vollständiges `verify` nach jeder einzelnen Audit-ID. Das Pflichtprofil
läuft an den definierten Meilensteinen und zusätzlich nur dann, wenn ein
risikoreicher Querschnittsrefactor dies rechtfertigt.

## Commit-Schnitt

Ziel sind typischerweise etwa 8–12 fachlich verständliche Commits, nicht 28
Mikrocommits. Beispiele:

- Snapshot-Vertrag + Streaming
- Gate-Semantik
- Verifier-Retry/Coverage
- Frontend-Verifikationsstatus
- Git-Commit-Erkennung
- Verify/CI-Abdeckung
- Permission-Grenze / F-06-Entscheidung
- Hot-Path-Performance
- Low-Risk Tests/Doku
- optionale Vereinfachungen
- finale Evidenz

Mehrere IDs dürfen in einem Commit landen, wenn sie denselben Kontrollpfad
bilden und gemeinsam rückrollbar sind. Unabhängige Sicherheitsfixes nicht in
einen Sammelcommit mischen.

## Teststrategie

### Pro Änderung

Nur die direkt relevanten Unit-/Integration-/Contract-/GUI-Regressionstests.

### Vollständiges Pflichtprofil

`npm --prefix npm run verify` nur verpflichtend:

1. als Baseline;
2. am **Checkpoint A** nach F-01–F-10;
3. final;
4. optional zusätzlich nach einem großen Querschnittsrefactor, wenn das Risiko
   dies rechtfertigt.

`npm --prefix npm test` separat nur dann, wenn es im finalen `verify` nicht
vollständig enthalten ist.

### Verifier

Verifier-Delegation vor einem Commit nur, wenn geschützte Pfade gemäß
`extensions/permissions/verifier-required-paths.ts` berührt sind. Zusätzlich
ein finaler Verifier-Pflichtlauf über den Gesamtstand, sofern die Remediation
geschützte Pfade berührt.

## Statusmodell

`08_TRACEABILITY_MATRIX.md` ist die einzige Statusquelle für F-01–F-28.
Zulässige Zustände:

- `offen` – noch nicht bearbeitet;
- `blockiert` – temporär, mit realem Blocker;
- `behoben` – Produktionsänderung + Regressionsevidenz;
- `widerlegt` – konkrete Gegen-Evidenz;
- `bewusst behalten` – Verhalten bleibt nach dokumentierter Abwägung;
- `deferred` – **nur P2/P3**, mit Grund, Rest-Risiko und Wiederaufnahme-Trigger.

P0/P1 dürfen am Critical Checkpoint nicht `offen`, `blockiert` oder `deferred`
sein.

## Meilenstein A – Critical Remediation

Umfasst F-01–F-10. Abschluss siehe
`04_CHECKPOINT_A_CRITICAL_DONE.md`.

Dieser Stand muss eigenständig review-/mergefähig sein. Späteres P2/P3-Cleanup
darf diesen Meilenstein nicht nachträglich zur Voraussetzung haben.

## Meilenstein B – Gesamtpaket

F-11–F-28 klassifizieren und nur sinnvolle Cleanup-/Vereinfachungsänderungen
umsetzen. P2/P3 dürfen begründet `bewusst behalten` oder `deferred` werden.

## Globale Abschlusskriterien

- F-01–F-28 besitzen genau einen Endstatus in der Traceability-Matrix;
- kein bestätigter P0/P1-Befund ist offen;
- Critical Checkpoint ist grün;
- finales Pflichtprofil ist grün;
- notwendiger Verifier-Lauf liefert PASS bzw. nur explizit akzeptierte,
  nicht-blockierende Warnungen;
- keine Benchmark-/Modellserie wurde gestartet oder verändert;
- keine ungewollte Bedienänderung an Shortcuts/Shift+Tab;
- Arbeitsbaum ist sauber;
- kein Push/Merge ohne separaten Auftrag.
