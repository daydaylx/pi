# Project State

## Aktuelle Arbeit

Repository-Audit und gezielte Nachbesserungen (Plan:
`.agent/plans/current-plan.md`, Ausgangs-HEAD `a25f1f7`). Ziel: ausgelieferte
Importfehler verhindern, Aurora-/Dashboard-Tests stabilisieren, Tool-Ausgaben
verbessern, Installer/Doku/Verifikation konsistent machen, Benchmark-
Konfiguration prüfen. Der Arbeitsbaum enthielt bereits umfangreiche
fremde Änderungen — sie wurden vollständig erhalten.

## Umgesetzt (dieser Auftrag)

- **Release-Defekt beherrschbar gemacht**: Ursache von CI-Verify-Failure
  #156 war `extensions/aurora-ui/index.ts` → `./dev-diagnostics.ts` ohne
  versionierte Datei. Die Datei bleibt (inert ohne `PI_AURORA_DIAG=1`,
  Vertragstests in der Runtime-Suite). Neu:
  `scripts/check-relative-imports.mjs` (lexerbasierter Literal-Check, grün)
  und `scripts/check-versioned-tree.mjs` (exportiert `HEAD`, prüft Imports,
  lädt aktive Extensions). Gegen den aktuellen HEAD schlägt der Check
  **erwartungsgemäß** fehl, bis `dev-diagnostics.ts` committet ist — das ist
  der beabsichtigte Nachweis der Commit-Grenze. npm-Skripte
  `check:imports`/`check:versioned-tree` vorhanden.
- **Dashboard/UNVERIFIED**: `UNVERIFIED` erzeugt keine platzfressende
  „Noch nicht bereit“-Zeile mehr; drei veraltete Runtime-Assertions an die
  dokumentierte Präzedenz (Decision 019/README) angepasst.
- **Compact-Tool-Receipts**: `collapse-result.ts` zeigt informative
  Einzeilen-Receipts (read/grep/find/ls/write/bash) statt nur Ctrl+O-Hint;
  Fehler, Partial Output, Truncation und leere Ergebnisse bleiben beim
  nativen Renderer; `read`/`write` mit Collapser verdrahtet; 11 Receipt-Tests.
- **Installer/Doku**: `APPEND_SYSTEM.md` auf phasenbasierte Narration
  umgestellt; Installer-Allowlist umfasst jetzt `APPEND_SYSTEM.md` und
  `prompts/` samt Installer-Test; README dokumentiert die
  Installationsgleichheit; Manual-Smoke-Checkliste trennt
  Arbeitsbaum-/HEAD-/CI-Nachweise und enthält Terminal-Matrix (Kitty,
  WezTerm, Ghostty) plus manuelle GitHub-Ruleset-Anleitung; UX-Doku an das
  tatsächliche Command-Center-Fuzzy-Filter- und Dashboard-Verhalten
  angepasst; Decision-Index 010 auf 20.000-Token-Upstream-Default korrigiert.
- **Verifikationsausgabe**: `project_check` nennt jetzt explizit den
  Prüfstand („Workspace-Snapshot …, versionierter HEAD nicht geprüft“) in
  Text und Details (`checkedWorkspaceFingerprint`, `checkedVersionedHead`);
  Runtime-Test mit echtem Git-Temp-Repo.
- **Benchmarks**: `p4-production-stack-manifest.json` auf Produktionsrollen
  aus Settings plus 15 vorbereitete Baseline-Läufe erweitert (01/04/08 je
  3×, Task 10 mit/ohne Subagent je 3×). Tokenmetrik präzisiert:
  `cacheRead`/`cacheWrite` getrennt, `providerReportedTotal` = rohes
  `usage.totalTokens` (kann Cache-Anteile enthalten, keine Formel aus
  input+output+reasoning); SCORING.md korrigiert, Schema erweitert,
  Aggregationstest ergänzt. **Keine kostenpflichtigen Provider-Läufe
  gestartet** (Freigabe ausstehend).
- **TUI-Grenzfälle**: Startscreen-Matrix um 40×12 ergänzt (52×14/90×28/
  120×30 bereits vorhanden); Filter/Escape/Backspace/Long-Path-Fälle waren
  bereits abgedeckt.
- **Konsistenztest**: `pi-subagents`-Commit-Pin in `settings.json`,
  `npm/package.json` und Lockfile wird auf Gleichheit geprüft.

## Geänderte/Neue Dateien (dieser Auftrag)

Neu: `scripts/check-relative-imports.mjs`, `scripts/check-versioned-tree.mjs`,
`tests/check-relative-imports.test.mjs`, `tests/collapse-result.test.mjs`,
`benchmarks/harness/test/collect-metrics.test.mjs`.
Geändert: `extensions/aurora-ui/{tool-renderers,index,footer}.ts`,
`extensions/compact-tools/{collapse-result,index}.ts`,
`extensions/setup-core/index.ts`, `extensions/shared/layout.ts`,
`benchmarks/harness/{collect-metrics.mjs,schema/run-result.schema.json,
p4-production-stack-manifest.json}`, `benchmarks/SCORING.md`,
`scripts/install-user.mjs`, `APPEND_SYSTEM.md`, `README.md`,
`docs/manual-smoke-checklist.md`, `docs/pi_agent_ux_konzept.md`,
`docs/decisions/README.md`, `npm/package.json`, `tests/run-all.mjs`,
`tests/suites/runtime/{aurora-ui,installer,setup-core,target-config}.mjs`.

## Letzte Verifikation

`project_check({ profile: "verify" })`: Exit 0, Pflichtabdeckung 1/1.
Runtime-Suite **1111/1111**, UI-Suite 96, workflow-mode 381, LSP 182, diff 22,
Patches 50, Audit sauber; Prettier/Typecheck/Knip/Coverage grün.
Advisory: diff-viewer Coverage 75 % über Floor (62 %) — nur Hinweis.
`scripts/check-versioned-tree.mjs` schlägt gegen HEAD erwartungsgemäß fehl
(unversioniertes `dev-diagnostics.ts`), bis committet wird.

## Nächste Schritte

1. Nutzerentscheidung: Commit der Arbeitsbaumänderungen einfordern —
   insbesondere `extensions/aurora-ui/dev-diagnostics.ts` versionieren;
   erst danach wird `check:versioned-tree` grün und CI kann liefern.
2. Manuellen Live-Smoke laut `docs/manual-smoke-checklist.md` in echter
   TTY-Sitzung (Kitty/WezTerm/Ghostty) durchführen.
3. Kostenpflichtige Benchmark-Baseline-Läufe nur nach expliziter
   Kosten-/Laufzeitfreigabe starten (Manifest ist vorbereitet).
