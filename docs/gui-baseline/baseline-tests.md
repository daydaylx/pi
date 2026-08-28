# Baseline-Tests — Prüfinstrumente vor GUI-Arbeit (Phase 0)

## Kanonische Verifikationskette

`npm --prefix npm run verify` (nur als `project_check({profile:"verify"})`
ausgeführt aktualisiert Footer/Ledger), bestehend aus:

| Schritt       | Skript                      | Umfang                              |
| ------------- | --------------------------- | ----------------------------------- |
| format:check  | prettier --check ..         | gesamter Arbeitsbaum inkl. Markdown |
| typecheck     | tsc --noEmit                | TS-Projekt                          |
| deadcode      | knip                        | ungenutzte Exporte                  |
| test:coverage | tests/coverage.mjs          | Suite-Läufe mit Coverage-Floor      |
| test:patches  | tests/runtime-patches.mjs   | Patch-Skript gegen Fixture          |
| audit:check   | scripts/check-npm-audit.mjs | Dependency-Advisories               |

Dazu (außerhalb der Kette, bewusst): `tests/p1-runtime.mjs` —
Upgrade-Gate gegen die echte installierte Runtime (Version, Anker,
10 Reloads); `scripts/check-relative-imports.mjs` +
`scripts/check-versioned-tree.mjs` für Auslieferbarkeit von HEAD.

## Regressionssuiten (tests/run-all.mjs, deterministische Reihenfolge)

`tests/suites/`: `diff.mjs`, `lsp.mjs`, `runtime.mjs`, `ui.mjs`;
unter `tests/suites/runtime/`: `ask-user`, `aurora-inspector`,
`aurora-ui`, `control-plane`, `installer`, `resilience`, `setup-core`,
`shortcuts`, `subagents-skills`, `target-config`, `verification`,
`web-access`.

Für GUI-relevante Phasen besonders wichtig:

- `runtime/aurora-ui.mjs` (~1.1k Zeilen stripAnsi-Assertions zu Dashboard,
  Footer, Startscreen) — State-Parität TUI↔GUI ab Phase 5 hier verankern
- `runtime/shortcuts.mjs` — Shortcut-Mapping-Baseline
- `runtime/setup-core.mjs`, `runtime/verification.mjs` — Verification-Wahrheit
- `ui.mjs` — Breitenklassen 30/50/80/120

## Manuelle Prüfungen

- `docs/manual-smoke-checklist.md`: Live-TTY-Smoke (Aurora-Sichtbarkeit,
  Shift+Tab, Plan→Work-Handoff, echter Subagent). Aus nicht-interaktiver
  Umgebung nicht durchführbar — offener P0-Punkt (#137).
- `PI_AURORA_DIAG=1` Renderzeitmessung (~1 ms/Frame Baseline).

## Baseline-Smoke-Test (Phase 0, dokumentiert)

- `pi --version` → 0.84.3 ✔
- `get_state`-RPC-Roundtrip → success:true mit vollständigem State ✔
- RPC-Fehlerfall → strukturiertes `success:false` ✔
- Nicht durchführbar ohne TTY: interaktiver Startbildschirm-/Dashboard-
  Sichtcheck. Der letzte verifizierte Stand der Kacheloptik ist im
  Commit `351da66` dokumentiert (Runtime-Suite 1111/1111, UI-Suite 122);
  die manuelle Terminal-Sichtprüfung bleibt offen und wird im
  Phase-0-Report als Restrisiko geführt.

## Regressionspflichten der GUI-Phasen (Vorschlag, in Testmatrix 14 überführt)

- Nach jeder Code-Phase: `project_check({profile:"verify"})`.
- Bei Runtimeberührung: zusätzlich `tests/p1-runtime.mjs`.
- Ab Phase 3: GUI-eigene Tests + E2E-Smoke; ab Phase 4 Shortcut-Parität;
  ab Phase 5 State-Divergenztests.
