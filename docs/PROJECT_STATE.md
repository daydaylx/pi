# Project State

## Aktuelle Arbeit

Audit-Umsetzung vom 2026-10-13 abgeschlossen, committet und gepusht (`main`
bis `e9a2302`, Fork `feat/temporary-agent-spec` auf `0364aaa`). Entfernt:
`second-opinion`, `diff-viewer`, `diff-learning`, LSP-Navigationstools,
Skill `lsp-navigation`, Alias-Befehle `/show-plan` und `/plan-edit`.
Gehärtet: Permission-Grenzen (inkl. Geräteziele unter `/dev/`), Verifier-Kette,
Repo-Gesundheit, Kindprozess-Umgebung und Run-History im Fork. Die zwölf
verwaisten Testdateien sind triagiert (Zwillinge bestehen, Duplikate gelöscht),
`tests/permissions.test.mjs` ist gegatet. Der Installer behält lokale
`+extensions/…`-Einträge der installierten `settings.json`. Die
Installation `~/.pi/agent` läuft auf Pi `1.0.4` mit allen 11 Runtime-Patches;
Rückfall-Backup unter `~/.pi/backups/agent-20261013-vor-runtime-update`.

Zusätzlicher Auftrag „Pi Harness Update Paket“: P1 Context Capsule, P2
Instruction Audit und P3 Task-Tier-Nachschärfung sind umgesetzt. P3 lässt
Risikowörter allein höchstens NORMAL auslösen, sammelt Laufzeit-Risiken und
ergänzt Anfangs-/Endklasse, Eskalationsgründe und False-Positive-Kandidaten in
der Telemetrie. Der 30-Aufgaben-Vergleich in `tests/task-tier.test.mjs` ergibt
9 Fehlklassifikationen mit der alten und 0 mit der neuen Heuristik. P4 ist als
isolierter, skill-only Agent-Plugin-PoC für `doc-diff` abgeschlossen:
`experiments/agent-plugin-poc/`. Der Skill ist byte-identisch kopiert, das
Manifest lokal geprüft; der Plugin-Host wurde nicht installiert oder gestartet.
P5 ist als No-Go abgeschlossen: Die Baseline erfasst 12 Verifier-Aufrufe über
9 Tasks. Aus Sitzungsprotokollen sind sieben fachliche Verdicts und konkrete
Findings rekonstruierbar; False-Positive-Raten bleiben mangels Adjudikation
offen. Daher wurde kein Observer-Code erstellt; Wiederaufnahme-Kriterien
stehen in `docs/experiments/p5-observer-baseline.md`.

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

- Pi: Node `v22.23.2`, npm `10.9.8`, installierter Pi `1.0.4` (seit 2026-10-13).
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

- `npm run verify` auf reinem HEAD (nur getrackte Dateien, frische Kopie):
  Exit 0, alle acht Stufen, 4856 Assertions ohne Fehler; Lint 0 Fehler.
- Fork `pi-subagents` @ `0364aaa`: `typecheck` ok, Unit 1198/1198,
  Integration und E2E Exit 0 (außerhalb der Sandbox).
- Installation: `pi --version` = 1.0.4, `tests/runtime-patches.mjs` 52/52,
  `tests/p1-runtime.mjs` ok, Headless-Lauf und `subagent list` ok.
- Nicht belegt: interaktiver TUI-Rundlauf (Plan→Work, Shift+Tab) und die
  Recovery-Rate nach den Fixes — es existieren noch keine neuen Sitzungen.

## Nächste Schritte

1. Nach den ersten neuen Sitzungen `/session-health --days 7` ausführen und die
   Recovery-Rate gegen die Messung vor den Fixes vergleichen; erst dann
   Recovery weiter vereinfachen.
2. Fork-Richtung entscheiden: (a) WIP verwerfen, Pin `0364aaa` bleibt;
   (b) Strip-down fertigstellen (Executor auf den Einzelpfad reduzieren, 82
   Typfehler, Semantik von `status/stop/interrupt` ohne Async-Runner klären);
   (c) nur `74b95d6` übernehmen und `temporary-agent-policy.ts`, ADR 031 und
   Docs auf den Spec-Vertrag ohne `profile` umstellen.
3. Die `typebox`-Startwarnung des Forks erst nach (b) beheben; vorher bleibt
   sie bewusst bestehen.
