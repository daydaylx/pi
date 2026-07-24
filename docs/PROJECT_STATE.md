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

## GitHub-Issue-Triage (daydaylx/pi, Stand 2026-07-23)

12 offene Issues gesichtet (`gh issue list --state open`). Working Tree dabei
fast sauber (nur `docs/CONTEXT_LEDGER.md` + `settings.json` modifiziert) — die
Ledger-Notiz zu „24 uncommittierten Änderungen" ist veraltet.

### Status-Überraschung: LSP v1 ist im Code bereits fertig

`docs/LSP_INTEGRATION_PLAN.md` markiert **#93–#97 als „erledigt"**, und
`extensions/lsp/tools.ts` registriert alle fünf Tools (`lsp_diagnostics`,
`lsp_definition`, `lsp_references`, `lsp_hover`, `lsp_workspace_symbols`).
Die GitHub-Issues #95/#96/#97 sind dennoch offen → **Tracking-Lag**, kein
fehlender Code. Sie können nach Eigentümerbestätigung geschlossen werden
(housekeeping, kein Phase-2-Fix).

### Priorisierte Tabelle

| Tier | # | Titel | Typ | Scope | Risiko | Aufwand | Abhängigkeit |
|------|----|-------|-----|-------|--------|---------|--------------|
| 0 | #95/#96/#97 | LSP-Sync/Diagnosen, Tools, Steuerung | erledigt | close only | niedrig | trivial | Eigentümer schließt |
| **1** | **#98** | LSP: Tests, CI-Smokes, Doku, Migration | feature | `extensions/lsp`, `.github/workflows/lsp-smoke.yml`, `docs/` | niedrig–mittel | M | #93–#97 (fertig) |
| **1** | **#105** | Vertrauensgebundene Projekt-Verifikationsprofile | feature | neue Extension/Konfig, `setup.json` | mittel | M | — (Basis für #102) |
| 2 | #102 | Universelles Verifikations-Gate | feature | Core-Abschlussprozess | hoch | L | **#105** |
| 2 | #104 | Sichere Edit-Fallbacks + Edit-Metriken | feature | Edit-Tool + Metriken | mittel | M | optional #103 |
| 3 | #103 | Doom-Loop-/Festfahr-Erkennung | feature | Tool-Historie, querschneidend | mittel | M | — |
| 3 | #106 | Task-Contract + Scope-Kontrolle (ohne Planmodus) | feature | nutzt bestehende plan/execution-Logik | mittel | M | #102 |
| 3 | #107 | Sichere Wiederaufnahme nach Abbruch/Timeout/Provider | feature | Recovery-Statemachine | hoch | L | — |
| 4 | #108 | Reale Benchmark-Baseline | auswertung | 30 reale Läufe + externer Agent | mittel | XL (Messung) | benchmarks/ existiert |

### Empfehlung für die nächsten Phase-2-Zyklen

1. ~~**#98**~~ — **umgesetzt (2026-07-24):** Fake-LSP-Protokolltests waren bereits
   vollständig; ergänzt wurden separater Smoke-Workflow `.github/workflows/
   lsp-smoke.yml`, Standalone-Smoke-Harness `tests/lsp-smoke.mjs` (gegen
   `extensions/lsp` via jiti, SKIP bei fehlendem Binary, FAIL nur bei
   Crash/Orphan), Nutzer-Doku `docs/lsp.md` (Steuerung, Trust, Server-Matrix,
   Troubleshooting, Migration/Rollback), Beispiel `docs/lsp.example.json` und
   README-Querverweis. `verify` bleibt 637/0. **Offen:** erster echter CI-Smoke-
   Lauf (braucht Push + `workflow_dispatch` = Nutzerauftrag) und Schließen des
   GitHub-Issues durch Eigentümer. Tracking-Lag #95–#97 (Code fertig) ebenfalls
   schließbar.
2. ~~**#105**~~ — **umgesetzt (2026-07-24):** vertrauensgebundene projektlokale
   Verifikationsprofile als separate Schicht (`.pi/verify.json`), die die
   unverletzliche Setup-Verifikation nicht berührt. Neues Modul
   `extensions/setup-core/verify-profiles.ts` (Schema + Loader + Runner mit
   DI, kein Shell, cwd-Traversal-Schutz, Additiv-env, fail-closed),
   `/setup-doctor`-Diagnosezeile, 45 neue Tests (Trust-Gate, Schema, cwd,
   no-shell, timeout, missing_binary), Doku `docs/verify-profiles.md` +
   Beispiel. `verify`: 637→682, 0 Fehler. **Offen:** Schließen des GitHub-Issues
   durch Eigentümer.
3. ~~**#102**~~ — **umgesetzt (2026-07-24, Advisory-MVP):** universelles
   Verifikations-Gate als neues Modul `extensions/setup-core/verification-gate.ts`
   + `/verify-gate`-Kommando. Bewertet Arbeitsauftrag + Working-Tree-Diff +
   Scope-Hinweise + Setup-Verify (typecheck/test) + #105-Projekt-Profile
   gemeinsam, liefert strukturierten Bericht + Status (pass/fail/blocked).
   Advisory (blockiert `/done`/`/finish` nicht). 35 neue Tests (parseGitStatus,
   aggregateStatus, runVerificationGate mit DI: pass/fail/blocked, leerer Diff,
   Profile trusted/untrusted, formatGateReport), Doku `docs/verification-gate.md`.
   `verify`: 682→717, 0 Fehler. **Offen:** Hard-Enforcement in `/finish` +
   Schließen des Issues (echtes Scope-Drift jetzt via #106 verfügbar).
4. ~~**#106**~~ — **umgesetzt (2026-07-24):** Task-Contract + Scope-Kontrolle
   als leichtgewichtiges, eigenständiges Modul
   `extensions/setup-core/task-contract.ts`. Kompakter Contract (Ziel,
   Acceptance-Kriterien mit Status, expectedScope als Globs, nonGoals,
   verification, assumptions getrennt von Vorgaben, optionale planId-Referenz)
   in flüchtigem `.agent/task-contract.json`. Eigener Glob-Matcher (keine neue
   Dep), `matchScope`/`analyzeScopeDrift`. **Ins Gate integriert:** echtes
   Scope-Drift (out-of-Scope-Dateien) + offene/broken Kriterien als Restrisiken.
   Referenziert planId ohne zweite Zustandsmaschine (plan-mode/state.ts
   unberührt). 32 neue Tests, Doku `docs/task-contract.md`. `verify`: 717→749,
   0 Fehler. **Offen:** Contract-Anlegung ist Skill-/Prompt-Aufgabe (nicht
   Code); Schließen des Issues.
5. ~~**#103**~~ — **umgesetzt (Advisory-MVP):** Doom-Loop- und Festfahr-
   Erkennung als reine Detektionslogik (`extensions/setup-core/doom-loop.ts`)
   + dünnes Event-Wiring in setup-core. `normaliseSignature` (edit/oldText,
   bash/command, read/path, …), `HistoryBuffer` (Ringpuffer), `detectLoop`
   (identical-failure ≥2x gleiche Sig-Fehler; stuck-tool ≥3x gleicher
   ToolName-Fehler). Advisory: publiziert via `appendEntry("doom-loop", …)`;
   `/setup-doctor` zeigt letzten Loop-Status. 23 neue Tests. `verify`:
   749→772, 0 Fehler. **Offen:** Reaktionen (Strategie-Stop, Oracle-Vorschlag,
   blocked) als Folge; Schließen des Issues.

### Verworfene direkte Sprünge

- #102 vor #105: Gate braucht die Profile zuerst.
- #108 jetzt: Messaufgabe eigener Art, braucht reale 30 Agent-Läufe + externen
  Agent — nicht im kleinen Fix-Fluss lösbar, eigener Track.
- #95–#97 neu implementieren: Code ist vorhanden, keine Arbeit.

### Abhängigkeitsgraph

```
#105 ──▶ #102 ──▶ #106
#103 ──▶ #104 (optional)
#98  (schließt LSP-Epic #92 ab, sobald #95–97 closed)
#107 (eigenständig, aber größere Recovery-Logik)
#108 (Messung, parallel/letzter Track)
```

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
