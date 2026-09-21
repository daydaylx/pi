# Project State

## Aktuelle Arbeit

Aurora Forge: Weiterentwicklung der CLI/TUI-Theme- und Motion-Darstellung.
Die Ausgangsarchitektur ist analysiert; der gespeicherte Plan wurde ausdrücklich
freigegeben. Als nächstes werden Theme-/Setup-Grundlagen, die zentrale
Visual-State-Zuordnung und danach die Renderer umgesetzt. GUI, Agentenlogik,
Workflow-/Permission-Semantik und der native Editor bleiben außerhalb des
Scopes.

## In dieser Sitzung umgesetzt

- `themes/aurora-forge.json` eingeführt; `aurora-night` bleibt vorhanden und
  `setup.json`/`settings.json` verwenden Forge als aktives Standardtheme.
- `expressive` als Motion-Modus ergänzt; gemeinsamer Aurora-Ticker bleibt die
  einzige Clock.
- `extensions/aurora-ui/visual-state.ts` eingeführt und Activity-, Tool-,
  Subagent-, Verification- und Badge-Darstellung semantisch angebunden.
- Setup-Schema, Kontrast-/Statusabstandsprüfung, Runtime-/UI-Tests, README und
  ADR 028 aktualisiert.

## Umgesetzt (Phase 2)

- **2.1 project_check/verify-Diagnose:** `project_check` nennt jetzt
  `projectRoot`/`configSource` in `details` und eine `Projektwurzel: …`-Zeile
  im Text. `verify` nennt explizit die geprüfte Wurzel (Agent-Verzeichnis)
  UND die aktive Projektwurzel, mit dem Hinweis, dass `verify` absichtlich
  nie das Projekt prüft (siehe bestehender Kommentar in `setup-core/index.ts`
  — architekturbewusst nicht verändert, nur die Ausgabe geschärft).
- **2.2 Skill-Blockade-Resilienz:** `workflow-policy.ts`s harte
  Projekt-/Symlink-/Secret-Grenze trägt jetzt einen Recovery-Hinweis
  ("kein Abbruchgrund"); `AGENTS.md` verbietet Aufgabenabbruch nach einer
  einzelnen blockierten Ressource. Kein Code-Bug gefunden — der ursprüngliche
  hard-06-Abbruch war Modellverhalten nach einem bereits korrekt
  strukturierten Toolfehler, kein Absturz.
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

- `project_check({ profile: "verify" })`: PASS; Formatcheck, Typecheck,
  Knip, Coverage, Runtime-/UI-/Workflow-/LSP-/Diff-Suiten, Frontend- und
  GUI-Tests sowie Audit erfolgreich.
- Aurora-Runtime: 1740 Tests grün; UI: 143; Workflow: 834; LSP: 182; Diff: 22;
  Theme-Kontrast/Statusabstand: 62 Tests grün.
- Renderdiagnostik im Verify-Lauf: 400 Frames, durchschnittlich ca. 1,23 ms
  pro Frame; keine zusätzlichen Timer pro Tool oder Subagent eingeführt.
- Der Verify-Stand gilt für den Workspace-Snapshot; der Workspace enthält
  weiterhin zahlreiche vorbestehende, nicht zu Aurora gehörende Änderungen.

## Nächste Schritte

1. Geänderten Aurora-Diff gegen vorbestehende Nutzeränderungen prüfen.
2. Optionalen manuellen TUI-Smoke-Test in echten Terminals durchführen.
3. Nach Nutzerfreigabe entscheiden, ob Forge dauerhaft Standard bleiben soll.
