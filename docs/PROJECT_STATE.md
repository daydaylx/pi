# Project State

## Aktuelle Arbeit

Review und Remediation der letzten fünf Sitzungslogs. Behoben: Verify-Specs
erhielten wegen der Hook-Reihenfolge kein gebundenes Ticket; der lokale Pi-Pin
ist auf Pi `1.0.4` angeglichen. Die Runtime-Patches wurden portiert; der
`brace-expansion`-Audit-Befund ist durch `5.0.12` behoben. Der frühere
UI-Suite-Hang reproduzierte sich nicht. Das kanonische Pflichtprofil
`project_check({ profile: "verify" })` besteht; offen sind der unabhängige
Verifier und der providerbasierte Live-Smoke (#137).
`npm ci --ignore-scripts` war nötig, weil `node-pty` hier keine nativen
Buildskripte ausführen konnte. Änderungen sind noch nicht committet oder
gepusht.

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

- `npm --prefix npm run typecheck`: bestanden.
- `PI_TEST_SUITE=runtime`: 1810/1810 bestanden gegen Pi `1.0.4`.
- `PI_TEST_SUITE=ui`: 143/143 bestanden; der frühere Hang und
  `header.renderHeaderLines`-Befund sind veraltet.
- `npm --prefix npm run test:patches` (52), `test:runtime` und
  `test:frontend-contracts` (21): bestanden; P1-Regressionslauf gegen Pi
  `1.0.4` ebenfalls bestanden.
- `npm --prefix npm run audit:check`: bestanden nach sauberer Installation
  mit `brace-expansion@5.0.12`.
- Der gezielte Benchmark-Duel-Test bestand mit dem NixOS-kompatiblen PATH.
- Kanonischer `project_check({ profile: "verify" })`: PASS, alle deklarierten
  Prüfschritte bestanden; Lint meldete 561 Warnungen und keine Fehler.
- Offline-TUI-Start mit Pi `0.87.1` gelang; Shift+Tab zeigte den Aurora-
  Workflow-Bereich. Ein no-tools Provider-Print-Smoke antwortete erfolgreich;
  ein interaktiver Plan/Work-Rundlauf ist noch offen.
- Unabhängiger Projekt-Verifier ist für den aktuellen Arbeitsbaum noch
  auszuführen.
- Nach P1/P2: `PI_TEST_SUITE=runtime` bestanden (1837/1837),
  `npm run typecheck`, `npm run deadcode`, ESLint (0 Fehler, 561 Warnungen),
  Prettier-Check und `git diff --check` bestanden. Die Skill-Validierung über
  `quick_validate.py` war mangels `python3` nicht ausführbar; die Runtime-Suite
  prüfte Skill-Frontmatter und Beschreibung.
- Nach P3: `node tests/task-tier.test.mjs` bestanden (67/67),
  `npm run typecheck`, `npm run lint` (0 Fehler, 561 Warnungen), gezielter
  Prettier-Check und `git diff --check` bestanden.
- Nach P4: Manifest-JSON und Pflichtfelder geprüft, Skill-Kopie byte-identisch,
  kein unnötiges `mcp.json`, Prettier-Check und `git diff --check` bestanden.
  Ein Plugin-Host-Lauf wurde bewusst nicht durchgeführt.
- Nach P5: Run-History aggregiert (12 Calls, 4.307.790 Tokens, 1.986.317 ms),
  sieben fachliche Verdicts und deren Findings in Sitzungsprotokollen
  rekonstruiert; False-Positive-Raten mangels Adjudikation weiterhin offen.
  Baseline-Bericht formatiert; Verify-Profil und `git diff --check` bestanden.
- Nach Review-Findings: P5-Bericht enthält sieben anonymisierte, lokal
  rückverfolgbare Verdict-Zeilen; Capsule-Redaktion deckt benannte Felder,
  Bearer- und gängige AWS/OpenAI/GitHub-Tokenmuster ab. Die Heuristikgrenzen
  sind dokumentiert.
- Abschließender kanonischer `project_check({ profile: "verify" })` via lokale
  Pi-CLI mit Nix-PATH: PASS, Exit 0. Coverage umfasst `context-capsule` mit
  5/5 und `task-tier` mit 9/9 Funktionen; Lint meldete 561 Warnungen und keine
  Fehler. Die Runtime-Suite bestand nach den letzten Änderungen mit 1841/1841.
- Der unabhängige Verifier meldete zuvor FAIL wegen einer nicht begründeten
  Modellfreischaltung und zwei Dokumentations-/Abdeckungswarnungen. Die
  Modellfreischaltung bleibt gemäß ausdrücklicher Nutzeranweisung „alles
  committen“ enthalten; P5-Belegzuordnung und Capsule-Redaktion wurden danach
  ergänzt, aber noch nicht unabhängig erneut bewertet. Deshalb sind Commit,
  Push und Live-Duell offen.

## Nächste Schritte

1. Unabhängigen Verifier-PASS für den exakten aktualisierten Arbeitsbaum
   nachholen.
2. Den ausdrücklich autorisierten Commit und Push getrennt ausführen.
3. Codex-vs-Pi-Live-Duell auf dem gepushten Stand mit der vorhandenen
   `SEC-001`-Aufgabe starten und vergleichen.
