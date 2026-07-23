# Project State

> Flüchtiger Arbeitszustand (aktuelle Phase, letzte Verifikation, nächste
> Schritte). Dauerhafte Fakten — bestätigte Entscheidungen, Architektur­ent­schei­dungen,
> Nicht-Ziele, Einschränkungen, offene Risiken, Projektregeln — stehen im
> Context Ledger: `docs/CONTEXT_LEDGER.md`. Hier nicht duplizieren, sondern
> referenzieren.

## Aktuelles Ziel

Ein eigenständiges, komfortables und stabiles Pi-Setup mit Aurora-Night-UI,
zentraler Konfiguration, expliziten Berechtigungsgrenzen und einem belastbaren
Plan-/Work-Workflow betreiben. Nicht-Ziele und aktive Entscheidungen: siehe
`docs/CONTEXT_LEDGER.md`.

## Aktuelle Phase

Option 2 mit den Nutzerzusätzen ist implementiert und vollständig verifiziert.
Die Übergabe erfolgt ohne Commit, Push oder Paketinstallation.

## Umgesetzt

- `setup.json` ist die zentrale, validierte Konfiguration für UI, Permissions,
  LSP, Subagenten, Modellrollen und allowlist-basierte Verifikation.
- Aurora Night besitzt Editor, Footer, Activity-Widget und Working-Indikator;
  die Darstellung reagiert auf Terminalbreite und Motion-Modus und räumt alle
  Session-Ressourcen beim Shutdown auf.
- Der Planworkflow verwendet Sidecar v2 mit stabiler `planId`, Revision,
  Lifecycle, Todo-Hash und gebundener `executionId`; Lock/CAS-Schreibvorgänge
  und konservative Migration schützen ältere oder konkurrierende Zustände.
- Plan-, Review-, Decision- und Completion-Ergebnisse werden erst bei
  `agent_settled` finalisiert; Retries zählen nur mit ihrem letzten Ergebnis.
- Planning, Review, Decision, Execution, Paused, Blocked und Ready besitzen
  technisch erzwungene Workflow-Capabilities.
- LSP nutzt eine exakte Tool-Allowlist; `verify` nur die festen Setup-Prüfungen.
- Subagenten laufen mit maximal vier parallelen Tasks und rollenbezogen
  reduzierten Tool-Sets; Testläufe verwenden `verify` statt freien Bash.
- Der Installer ist standardmäßig ein Dry-Run mit Allowlist, schließt Secrets
  und Laufzeitdaten aus und verweigert Symlinks.
- Context Ledger: getrennte, dauerhafte `docs/CONTEXT_LEDGER.md` plus
  deterministische Auto-Konsolidierung (ohne Modell-Turn) an den plan-mode-
  Checkpoints und eine kompakte Recovery-Kopfzeile bei `session_start`.

## Letzte Verifikation

- `npm run verify` (lokal, `~/.pi/agent`): 599 bestanden, 0 fehlgeschlagen;
  `npm run typecheck`: erfolgreich mit `strict: true`.
- In CI/Fremdumgebungen zeigen sich zwei umgebungsbedingte Fehler
  (CLI-Versionsdrift, abweichender Arbeitsverzeichnis-Pfad) — kein
  Regressionsindiz, siehe `docs/CONTEXT_LEDGER.md`.
- `git diff --check`: erfolgreich.

## Bekannte offene Punkte

- P0.4 (Fresh Checkout): Root-`package.json` bleibt unversioniert, ist aber mit
  ALLOWLIST dokumentiert.
- P1.3 (Test-Wartbarkeit): Temp-Cleanup-Hooks wurden noch nicht eingeführt.
- Ein echter Provider-/Authentifizierungsdurchlauf wurde bewusst nicht gestartet
  und `auth.json` nicht gelesen. Theme, Lifecycle, Toolregistrierung und UI-
  Breakpoints sind im Harness geprüft.
- Weitere dauerhafte Einschränkungen/Risiken: siehe `docs/CONTEXT_LEDGER.md`.
- Ausführliche Plan-Workflow-Mechanik (CAS-Fail-Closed, Session-Epoch-Bindung,
  Execution-Hash, LSP-Trust-Details): siehe `README.md`.

## Nächste drei Schritte

1. Benchmark-Aufgabe 11 (Context-Ledger-Survival) real gegen die Baseline laufen
   lassen und Messgrößen 13–15 auswerten.
2. Token-Schwelle des Compaction-Proxys unter realer Last beobachten und ggf.
   justieren.
3. Ledger-Größe bei fortlaufender Nutzung prüfen und veraltete Einträge
   kuratieren, statt den Ledger wachsen zu lassen.

## Vorgelegte Planungsgrundlage

- [`docs/empfehlungsbericht.md`](empfehlungsbericht.md) – strategisches Dach (was übernehmen / vereinfachen / ablehnen), Stand 20.07.2026.
- [`docs/auftraege/arbeitsauftraege.md`](auftraege/arbeitsauftraege.md) – 17 verbindlich geordnete Aufträge, abgeleitet aus dem Empfehlungsbericht.
- [`docs/auftraege/auftrag.md`](auftraege/auftrag.md) – **überholt**, siehe Kopfvermerk in der Datei: beschreibt eine kleinere 3-Fall-Pilotphase, die durch die tatsächlich umgesetzte 10-Aufgaben-Vollversion unter `benchmarks/` abgelöst wurde.

**Auftrag 1 (Qualitätsbenchmark definieren) ist abgeschlossen:** Alle 10
Aufgabentypen sind unter `benchmarks/tasks/` vollständig spezifiziert, samt
lauffähiger Harness (`reset-task.sh`, `run-verify.sh`, `collect-metrics.mjs`,
JSON-Schema), committet in `37b5641`. Ein erster End-zu-End-Pilotlauf
(Aufgabe 02, lokaler Bug) wurde real durchgeführt und hat den Harness
validiert; dabei zwei Bugs gefunden und behoben:

1. Drei `TASK.md`-Dateien (02, 03, 05) verwiesen im Auftragstext auf
   `fixture/...`, obwohl `reset-task.sh` das Overlay tatsächlich nach
   `benchmark-fixture/...` kopiert — korrigiert.
2. `reset-task.sh` ließ das kopierte Fixture-Verzeichnis komplett untracked;
   `git diff --numstat` (Basis für die Messgröße "geänderte Dateien/Zeilen" in
   `collect-metrics.mjs`) erkannte dadurch spätere Agent-Änderungen nicht.
   Fix: `git add` direkt nach dem Kopieren (kein Commit, nur Staging).

Ergebnis des dritten (sauberen) Laufs liegt unter
`benchmarks/results/02-local-bug-pilot-20260720-2228.json`: Agent hat den
Bug korrekt gefunden und minimal behoben (`solvedWithoutCorrection: true`,
1 Zeile geändert, keine Scope-Abweichung).

**Auftrag 2 (Baseline messen) ist vorbereitet, aber noch nicht durchgeführt:**
`benchmarks/harness/run-baseline.sh` verkettet die RUNBOOK.md-Schritte 1
(Reset), 3 (Verify/Fixture-Test) und 4 (Metriken sammeln) für einen
einzelnen Lauf (`prepare <task-id>` → Agent arbeiten lassen → `finish
<task-id>`); erkennt Fixture-Test- (02, 03, 05) und testfreie Aufgaben (06, 09) automatisch und findet die passende Session-Datei über das
Fensterstart-/Sessionverzeichnis-Muster. Gegen Aufgabe 01 erfolgreich
end-to-end getestet (Verify- und Collect-Pfad, danach wieder aufgeräumt,
kein Ergebnis in `results/` committet). Schritt 2 (Agent) und Schritt 5
(`manualAssessment` ausfüllen) bleiben bewusst manuell.

Entscheidungen für den eigentlichen Messdurchlauf (23.07.2026): aktuelle
Default-Konfiguration aus `setup.json`/`settings.json` (kein Wechsel), 3
Wiederholungen pro Aufgabe (30 Läufe gesamt über alle 10 Aufgabentypen).

**Nächster Schritt:** die eigentlichen 30 Baseline-Läufe mit
`run-baseline.sh` durchführen (empfohlene Reihenfolge laut `README.md`: 02
und 09 zuerst, da automatisiert prüfbar und ohne Compaction-/
Multi-Run-Komplexität), Ergebnisse unter `benchmarks/results/` ablegen und
`manualAssessment` je Lauf von Hand ausfüllen.

## Letzte Aktualisierung

2026-07-23 CEST
