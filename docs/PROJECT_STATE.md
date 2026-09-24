# Project State

## Aktuelle Arbeit

Pi-Harness- und Disa_Ai-Benchmark-Korrekturen aus der Desktop.zip-Auswertung.
Phase 2 (Pi-Infrastruktur: verify/project_check-Diagnose, Skill-Blockade-
Resilienz, headless-Berechtigungsstufe) ist in diesem Repo umgesetzt und
getestet. Phase 3 (Checker-Härtung für disa-hard-01/02/04/06/08) ist
**separat** im neuen, unabhängigen lokalen Repo
`/home/d/Projekte/aktiv/disa-benchmark-harness` umgesetzt (dort eigene
Commits, eigene Tests) — bewusst nicht hier, um nicht mit der Disa-Hard-
Checker-Infrastruktur unter `/home/d/.local/state/disa-duel/tasks` zu
kollidieren. Phase 4 (Metrikparser), Phase 5 (Ergebnispaket-Reproduzierbarkeit)
und Phase 6 (Dokumentation) sind noch offen. Disa_Ai bleibt unverändert
außerhalb des Produkt-Scope. Keine Modellläufe. Commit/Push dieser Sitzung
erfolgten auf ausdrückliche Nutzeranweisung.

## Umgesetzt (Phase 2)

- **2.1 project_check/verify-Diagnose:** `project_check` nennt jetzt
  `projectRoot`/`configSource` in `details` und eine `Projektwurzel: …`-Zeile
  im Text. `verify` nennt explizit die geprüfte Wurzel (Agent-Verzeichnis)
  UND die aktive Projektwurzel, mit dem Hinweis, dass `verify` absichtlich
  nie das Projekt prüft (siehe bestehender Kommentar in `setup-core/index.ts`
  — architekturbewusst nicht verändert, nur die Ausgabe geschärft).
- **2.2 Entkopplung Lese- vs. Mutationsgrenze (Permission-Architektur):**
  Die Projektgrenze wurde architektonisch sauber als reine Mutationsgrenze
  definiert. Normales Lesen (`read`, `grep`, `find`, `ls` sowie reine Bash-
  Diagnosekommandos im Planmodus) ist global freigegeben, sofern keine
  Secrets berührt werden und das Projekt vertrauenswürdig ist. Externe Symlinks
  sind beim Lesen über das kanonische Ziel zulässig; bei Mutationen (`write`,
  `edit`, mutierende Shell-Befehle) bleibt die Projekt- und Symlink-Grenze
  eine harte Barriere. In untrusted Projekten werden externe Lesezugriffe
  durch das Trust-Gate in `guards.ts` blockiert. Die frühere enge Ausnahme
  `isDocumentedRuntimeDocsRead` entfällt. Damit sind Skill-Dateien,
  Konfigurationen und externe Repositories lesbar.
- **2.3 headless-Berechtigungsstufe:** neue `PermissionLevel` `"headless"`
  (`shared/workflow-status.ts`, `shared/permission-policy.ts`,
  `permissions/tool-policy.ts`, `permissions/session-state.ts`,
  `permissions/menus.ts`). Erlaubt projektlokale
  Build-/Test-/Lint-/Typecheck-Kommandos (inkl. eng gefasstem
  `npx`/`npm exec`-Carve-out für bekannte Dev-Tools) ohne Bestätigungsdialog;
  jede sonst bestätigungspflichtige Aktion (Secrets, Systemgrenzen,
  destruktive Befehle, externe Schreibzugriffe, opake Interpreter) bricht
  strukturiert ab statt zu fragen. Frischer Session-Start außerhalb der TUI
  ohne persistierte Wahl defaultet jetzt auf `headless` statt
  `project-write`. `guards.ts` konvertiert zusätzlich generell jede
  `"ask"`-Entscheidung außerhalb der TUI in einen strukturierten Block (gilt
  für jede Stufe, nicht nur `headless`).

## Befundmatrix

| Ursache                                                                            | Komponente                         | Priorität | Geplanter Test                                                                  |
| ---------------------------------------------------------------------------------- | ---------------------------------- | --------- | ------------------------------------------------------------------------------- |
| Verify-/CWD-Bindung und fehlende Konfiguration müssen fail-closed sein             | Pi setup-core/verify               | P0        | Projektroot-, relative-, ungültige- und Symlink-Tests                           |
| Skill-Zugriff außerhalb registrierter Wurzeln kann den Lauf abbrechen              | Pi Skill-/Tool-Ladepfad            | P0        | erlaubter Loader, Blockade als Toolfehler, Fallback                             |
| JSON/headless blockiert lokale Build-/Testbefehle, `ask_user` ist nicht interaktiv | Pi Permission-Policy               | P0        | lokale Befehle, externe/Secret/destruktive Ziele, strukturierte ask_user-Fehler |
| Disa-Checker filtern fehlende Regressionen bzw. prüfen Anforderungen unvollständig | lokale Hard-Checker 01/02/04/06/08 | P0        | Baseline PASS/FAIL und gezielte Mutationen                                      |
| Replay-, Strategie- und exakte HTTP-Nachweise fehlen/zu schwach                    | Hard-08/04/01                      | P0        | Replay-Sequenz, auto/confirm-Mutationen, HTTP-Mutationsmatrix                   |
| Modellaufruf-/Turn-/Tokensemantik ist nicht einheitlich                            | OpenBench/Benchmark-Metriken       | P0        | Pi- und Codex-Fixtures, null- und Tokenformeltests                              |
| Fehlerhafte bzw. unvollständige Runs werden nicht getrennt bewertet                | Runner/Resultat/Report             | P1        | Versuchstaxonomie, Manifest- und Report-Regressionen                            |
| Archive/Hidden-Test-Namen und Provenienz sind nicht selbstprüfend                  | Pack-/Bundle-Smoketest             | P1        | fehlende/falsche Dateien, Hash- und Manifest-Mutationen                         |

## Phase-1-Bestand

- Pi: Node `v22.23.2`, npm `10.9.8`, installierter Pi `0.84.4`.
- Pi-`verify`-Profil: `.pi/verify.json`; setup-core liegt unter
  `extensions/setup-core/` mit `verify-profiles.ts`, `dependency-prepare.ts`
  und `index.ts`.
- Pi-Berechtigungen: `extensions/permissions/guards.ts`, `tool-policy.ts`,
  `session-state.ts`, `extensions/shared/permission-policy.ts`; vorhandene
  Tests liegen in `tests/suites/runtime/{verification,ask-user,setup-core}.mjs`
  und `tests/workflow-mode/permissions.test.mjs`.
- OpenBench: `obench/run.py`, `stats.py`, `publish.py`, `packs.py`,
  `validate_run.py`, `atif.py`/`tools/atif_convert.py` und die jeweiligen
  `obench/tests/`.
- Disa-Hard-Checker: `/home/d/.local/state/disa-duel/tasks/disa-hard-01` bis
  `disa-hard-08`; vorhandene Hidden-Test-Dateien sind in hard-02, hard-06 und
  hard-08. Diese lokalen State-Dateien sind keine Pi-Git-Dateien.
- Historische Pi-Real-Duel-Reports unter
  `benchmarks/real-duel/reports/` bleiben unverändert; die bekannte Telemetrie
  enthält `turn.completed` und `message_end`-Ereignisse.
- OpenBench `AGENTS.md` bestätigt: Checker ist alleinige Erfolgsinstanz,
  Transkripte bleiben lokal, Result-/Resume-/Digest-Pfade sind sensibel.

## Nicht-Ziele und Schutz

Keine neuen Pi-vs-Codex-Läufe, keine Übernahme von Disa-Kandidatenlösungen,
keine Änderung historischer Rohtranskripte/Kandidaten-Patches, keine pauschale
Sicherheitsabschwächung, kein permanenter `yolo`-Modus. Commit/Push nur auf
ausdrückliche Nutzeranweisung (erteilt für diese Sitzung). Vorbestehende
Änderungen in Pi und Disa_Ai erhalten. Secrets, Auth-Dateien und
Umgebungswerte nicht lesen oder veröffentlichen.

## Letzte Verifikation

- `npm run typecheck` (`tsc --noEmit`): sauber.
- `PI_TEST_SUITE=runtime`: 1532/1532 grün (inkl. `setup-core.mjs`,
  `verification.mjs`).
- `PI_TEST_SUITE=lsp`: 182/182 grün. `PI_TEST_SUITE=diff`: 22/22 grün.
- `tests/workflow-mode/permissions.test.mjs` (inkl. neuer `headless`-Tests:
  Build/Test/Lint/Typecheck-Allow, `npx`-Dev-Tool-Carve-out,
  Chaining-Schutz gegen den Carve-out, strukturiertes Deny statt Ask für
  Secrets/System/destruktive Befehle, Datei-Schreibzugriffe,
  Setup-Policy-`ask`→Block) und `tests/workflow-mode/e2e.test.mjs`: grün.
- **Bekannter, nicht von dieser Sitzung verursachter Bug:** `PI_TEST_SUITE=ui`
  hängt (unsettled top-level await, `tests/run.mjs:146`). Isoliert bestätigt:
  Der Hang bleibt bestehen, auch wenn ALLE Berechtigungs-Dateien (diese
  Sitzung und die vorherige YOLO-Sitzung) vollständig auf HEAD zurückgesetzt
  werden — die Ursache liegt in den unabhängigen `/thinking`-Verlagerungs-
  Änderungen (`tests/suites/ui.mjs`, `tests/shared/harness.mjs`,
  `extensions/permissions/thinking-control.ts`, `extensions/mode-permissions.ts`,
  `extensions/aurora-ui/tool-renderers.ts`,
  `tests/suites/runtime/aurora-ui.mjs`). Auf einem sauberen HEAD-Checkout
  (ohne jede uncommittete Änderung) hängt die UI-Suite nicht, schlägt aber
  mit einem anderen, ebenfalls vorbestehenden Fehler fehl
  (`header.renderHeaderLines is not a function`, Aurora-Tiles-Test). Beides
  ungelöst, keinem der beiden Sitzungsthemen dieses Dokuments zuzuordnen.

## Nächste Schritte

1. Phase 4 (Metrikparser: Pi-Modellaufrufe nur `message_end`+`assistant`,
   Codex-Turn ≠ Modellaufruf, `null` statt `0`) und Phase 5
   (Ergebnispaket-Manifest/Smoketest) — beide im Kontext von
   `disa-benchmark-harness`, nicht in diesem Repo.
2. Phase 6 (Dokumentation) nach Abschluss von 4/5.
3. Den vorbestehenden UI-Suite-Hang und den Aurora-Tiles-Fehler getrennt
   untersuchen (gehören zur `/thinking`-Verlagerung, nicht zu diesem
   Arbeitsauftrag).
