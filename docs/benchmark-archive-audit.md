# Benchmark-Archiv-Audit (Phase 0)

> Historisches Audit-Dokument zum Archivierungsauftrag vom 2026-09-04.
> Gehört zusammen mit [`docs/benchmark-history.md`](benchmark-history.md) zur
> Generationengrenze zwischen Legacy-Benchmarks und der neuen
> OpenBench-/Real-Duel-Generation.

## Ausgangsstand

| Feld                    | Wert                                                     |
| ----------------------- | -------------------------------------------------------- |
| Branch                  | `main`                                                   |
| HEAD (vor Archivierung) | `86dca927aa920020157e951786ffb7da5263620d`               |
| Dirty State             | sauber, keine uncommitted Änderungen                     |
| Remote                  | `origin` = `https://github.com/daydaylx/pi.git`          |
| Vorhandene Tags         | `backup/pre-minimal-rebuild`, `frontend-protocol-v1.0.0` |

## Vorhandene Benchmarkverzeichnisse

### `benchmarks/` (Generation 1, P3/P4)

- 211 git-getrackte Dateien, ~15 MB Arbeitskopie, keine ungetrackten Inhalte
  (kein eigenes `.gitignore`, alles was existiert ist auch committet).
- Unterstruktur: `tasks/` (10 Aufgabentypen 01–10), `harness/` (p3/p4/p5/p6-
  Runner, Schema, Tests), `comparisons/p5-luna`, `comparisons/p6-terra-
subagents` (inkl. `RAW/`), `results/`, `v2/` (Performance-Tasks 11–13),
  `README.md`, `RUNBOOK.md`, `SCORING.md`.

### `harbor-bench/` (Generation 2/3, Harbor Benchmark v2/v3)

- Nur 122 git-getrackte Dateien (~1 MB): `agents/` (Pi-/Codex-Harness-
  Adapter), `environments/`, `postprocess/`, `scripts/`, `tasks/` (hello-
  world, 02/05 aus Gen. 1, `_gate/*`, HTTPX-01–08 Hard Suite),
  `README.md`, `HARBOR_SETUP.md`, `ENVIRONMENT_LOCK.md`, `HTTPX_BASELINE.md`,
  `KNOWN_LIMITATIONS.md`, `PILOT_PLAN.md`, `PILOT_REPORT.md`, `SCORING_V3.md`,
  `TASK_MANIFEST.json`, `TASK_VALIDATION.md`, `TELEMETRY_SCHEMA.md`,
  `BENCHMARK_V3_FIXES.md`, `pyproject.toml`, `uv.lock`, `.gitignore`.
- **Zusätzlich ~38.800 ungetrackte Dateien, ~1,1 GB**, alle über
  `harbor-bench/.gitignore` (`.venv/`, `repos/`, `jobs/`, `__pycache__/`,
  `*.pyc`, `.env*`) bewusst von Git ausgeschlossen:
  - `harbor-bench/.venv/` — 258 MB, Python-Virtualenv, jederzeit aus
    `pyproject.toml`/`uv.lock` reproduzierbar.
  - `harbor-bench/repos/httpx/` — 366 MB, lokaler Klon des Zielrepos
    `encode/httpx` inkl. eigenem `.git`; Referenzcommit ist in
    `HTTPX_BASELINE.md`/`ENVIRONMENT_LOCK.md` dokumentiert, daher
    reproduzierbar.
  - `harbor-bench/jobs/` — 245 MB, **76 reale Lauf-Verzeichnisse** mit den
    Rohdaten (Trajektorien, Tool-Calls, Telemetrie) der tatsächlichen P5/P6-
    Pi-vs-Codex-Pilotläufe, Gate-Checks und Smoke-Tests. **Nicht
    reproduzierbar** (reale API-Läufe), **nie versioniert** gewesen.
  - `harbor-bench/.pytest_cache/` — 32 KB, irrelevant.

→ Offene Entscheidung an den Nutzer: siehe Abschnitt „Offene Frage:
`harbor-bench/jobs/`" unten.

## Klassifikation der Referenzen außerhalb der Benchmarkordner

| Fundstelle                                                                                                   | Art                                                                                                                                                                                                               | Aktion nötig                                                                                         |
| ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `tests/run-all.mjs` (9 Suite-Einträge `../benchmarks/harness/test/*.test.mjs`)                               | **aktive technische Abhängigkeit** — läuft über `npm run verify` → `test:coverage` → `coverage.mjs` → `run-all.mjs`                                                                                               | Suite-Einträge entfernen                                                                             |
| `scripts/check-relative-imports.mjs` (`DEFAULT_SOURCE_DIRS` enthält `"benchmarks/harness"`)                  | aktive technische Abhängigkeit (Teil der `relative-imports`-Suite in `run-all.mjs`)                                                                                                                               | Eintrag entfernen                                                                                    |
| `knip.json` (`"benchmarks/harness/**/*.mjs"` im `entry`-Array)                                               | aktive technische Abhängigkeit (`npm run deadcode`, Teil von `verify`)                                                                                                                                            | Eintrag entfernen                                                                                    |
| `.github/workflows/verify.yml` (`fetch-depth: 0` + Begründungskommentar)                                     | aktive CI-Abhängigkeit — **einziger** Grund für `fetch-depth: 0` im Repo (keine andere Stelle braucht volle Historie)                                                                                             | Auf Standard-Shallow-Checkout zurücksetzen, Kommentar entfernen                                      |
| `docs/benchmark-baseline.md`                                                                                 | Dokumentationsreferenz, thematisch vollständig Generation 1, enthält funktionierende Markdown-Links auf `../benchmarks/`                                                                                          | Nach `docs/archive/` verschieben (sonst kaputtes Docs-Linking)                                       |
| `docs/scope-cli-tui-vs-gui.md` (CLI/TUI-Routing-Tabelle, Zeile `benchmarks/` → „Agenten-Benchmarks")         | aktive Routing-Dokumentation für künftige Agenten                                                                                                                                                                 | Zeile entfernen                                                                                      |
| `docs/CONTEXT_LEDGER.md` (2 Stellen: `fetch-depth: 0`-Begründung; Tokenmetrik-Zitat `benchmarks/SCORING.md`) | lebendes Entscheidungsprotokoll, referenziert Benchmark-Pfade nur als Beleg für reale, weiterhin gültige Produktentscheidungen (Tokenmetrik-Semantik ist in `extensions/`, nicht in `benchmarks/`, implementiert) | Beleg-Zitate auf `docs/benchmark-history.md` umbiegen, fetch-depth-Begründung als erledigt markieren |
| `docs/repository-split-audit.md` (2 Erwähnungen: Klassifikationstabelle, Zielbaum-Beispiel)                  | reine Textnennung, kein Link; Dokument ist ein datiertes Audit-Snapshot („Stand: 2026-08-31, Ausgangscommit 6d8afc0")                                                                                             | **Keine Änderung** — Snapshot-Charakter macht die Erwähnung bereits historisch nachvollziehbar       |
| `docs/archive/arbeitsauftraege.md`, `docs/archive/REPOSITORY_AUDIT_2026-07-25.md`                            | historische Referenz, bereits unter `docs/archive/`                                                                                                                                                               | keine Änderung nötig                                                                                 |

Keine Treffer (geprüft, nichts gefunden) in: `AGENTS.md`, `README.md`,
`package.json`, `npm/package.json` (außer dem indirekten Aufruf von
`tests/run-all.mjs`), `tsconfig.json`, `settings.json`, `setup.json`,
`agents/*`, `.claude/`, `.agents/`, `.codex/`, `npm/package-lock.json`,
`docs/decisions/*`, `docs/PROJECT_STATE.md`, `docs/verify-profiles.md`,
`docs/runtime-matrix.md`. `harbor-bench/` hat **keine einzige** Referenz
außerhalb seines eigenen Verzeichnisses — vollständig isoliertes
Python/uv-Projekt.

## Gate-0-Ergebnis

1. **Welche Dateien werden archiviert?** Alle 333 git-getrackten Dateien
   unter `benchmarks/` und `harbor-bench/` (Tag/Branch). Offene Frage zu den
   ungetrackten 245 MB Rohdaten in `harbor-bench/jobs/` — siehe unten.
2. **Referenzen außerhalb der Benchmarkordner?** Ja, vollständig
   klassifiziert (Tabelle oben) — 4 aktive technische Abhängigkeiten, 3
   Dokumentationsstellen mit Änderungsbedarf, 1 unveränderte Snapshot-
   Erwähnung.
3. **Ruft `npm run verify` Benchmarks auf?** Ja — `benchmarks/harness/test/
*.test.mjs` läuft aktuell als Teil der Coverage-Suite. `harbor-bench/`
   wird von keinem Produktbefehl aufgerufen.
4. **Greifen CI/Hooks auf diese Pfade zu?** Ja, einmalig: `verify.yml`
   braucht `fetch-depth: 0` ausschließlich wegen
   `benchmarks/harness/p4-manifest.mjs`. Keine weiteren Workflows
   (`lsp-smoke.yml` frei von Benchmark-Bezug), keine Git-Hooks gefunden.

Gate 0 ist damit erfüllt — Phase 1 kann nach Klärung der offenen Frage
beginnen.

## Offene Frage: `harbor-bench/jobs/` — entschieden

245 MB reale, nie versionierte Pilotlauf-Rohdaten (76 Runs: Pi-vs-Codex-
Vergleiche, Gate-Checks, HTTPX-Hard-Suite-Smoke-Tests) lagen nur in der
Arbeitskopie. Ein reiner Git-Tag/Branch erfasst sie nicht.

**Nutzerentscheidung (2026-09-04): Verlust akzeptiert.** `harbor-bench/jobs/`
war nie Teil des Repos (`.gitignore`), gilt als Werkstattdaten. Der
synthetisierte Bericht `harbor-bench/PILOT_REPORT.md` ist git-getrackt und
bleibt im Archiv-Tag/-Branch erhalten.

## Phase 1/2 — Ergebnis

```text
Archive tag:
benchmark-legacy-v1-v3-2026-09-04

Archive commit:
86dca927aa920020157e951786ffb7da5263620d

Archive branch:
archive/legacy-benchmarks (identischer Commit)
```

Verifikation in frischem `git worktree` auf dem Tag (Phase 2):

- `benchmarks/` und `harbor-bench/` vorhanden.
- Zentrale README-/Runbook-Dateien vorhanden (`benchmarks/README.md`,
  `RUNBOOK.md`, `SCORING.md`, `harbor-bench/README.md`,
  `HARBOR_SETUP.md`, `ENVIRONMENT_LOCK.md`).
- Harbor-Pinning vorhanden (`pyproject.toml`, `uv.lock`).
- P5/P6-Vergleichsergebnisse vorhanden (`comparisons/p5-luna/RAW`,
  `comparisons/p6-terra-subagents/RAW`).
- Benchmark-v3-Dokumentation vollständig (`BENCHMARK_V3_FIXES.md`,
  `SCORING_V3.md`, `TELEMETRY_SCHEMA.md`, `PILOT_REPORT.md`, `PILOT_PLAN.md`,
  `TASK_VALIDATION.md`, `KNOWN_LIMITATIONS.md`, `HTTPX_BASELINE.md`).
  Alle 8 HTTPX-Hard-Suite-Tasks vorhanden.
- Dateiliste (`git ls-files benchmarks/ harbor-bench/`) im Worktree exakt
  deckungsgleich mit dem Stand vor der Archivierung (333/333 Dateien).

**Gate 2 erfüllt.** Phase 3 (Entfernen aus `main`) darf beginnen.

## Phase 7 — Verifikationshinweis

`npm run verify` schlug **transient** fehl, solange `git rm -r benchmarks/`
noch ungecommittet (staged) war: `shared/workspace-snapshot.mjs` ruft
`git diff --cached --binary` ohne explizites `maxBuffer` auf; die gelöschte
`benchmarks/comparisons/p5-luna.zip` (1,9 MB) erzeugt dabei einen ~15-MB-
Base64-Patch, der Node-`execFileSync`s Standardpuffer (1 MB) sprengt
(`ENOBUFS`) — der `resilience`-Test `recovery_check` ruft diese Funktion
gegen den echten Repo-Zustand auf (`ROOT`, kein synthetisches Fixture).
Verifiziert per `git stash`/`stash pop`: auf sauberem Baum (kein großer
staged/unstaged Diff) läuft die Suite grün durch. Ursache ist ausschließlich
der Zwischenzustand vor dem Commit, keine Regression durch die
Archivierung selbst und kein Grund, altes Benchmarkcode wieder
einzubinden — nach dem Commit in Phase 8 ist der Baum sauber und `npm run
verify` muss erneut laufen, um den finalen grünen Stand zu bestätigen.

## Phase 7 — finales Ergebnis (nach Commit `ea0d4d5`)

Auf sauberem, committetem Baum (`git status` leer):

| Schritt | Ergebnis |
| --- | --- |
| `format:check` | ✅ PASS |
| `typecheck` | ✅ PASS |
| `deadcode` (knip) | ✅ PASS |
| `test:coverage` (alle Node-Testsuiten inkl. `relative-imports`) | ✅ PASS — 2283 Einzeltests, 0 fehlgeschlagen |
| `test:patches` | ✅ PASS — 50 Tests |
| `test:gui` (`gui/test/format-check.mjs`) | ❌ FAIL — **vorbestehend, unabhängig von dieser Archivierung** |
| `audit:check` | ✅ PASS (isoliert verifiziert) |

Die `test:gui`-Formatabweichung (`gui/renderer/index.html`,
`gui/renderer/styles.css`) betrifft ausschließlich `gui/`-Dateien.
`git diff 86dca92 ea0d4d5 --stat -- gui/` ist leer — der Archivierungs-
Commit hat keine einzige Datei unter `gui/` verändert. Die Abweichung
bestand bereits vor dieser Archivierung und liegt außerhalb des Auftrags
(„keine Pi-Produktverhaltensänderung", keine GUI-Arbeit). Alle
archivierungsrelevanten Prüfungen sind grün; die GUI-Formatabweichung
bleibt als separates, vorbestehendes Ticket offen.
