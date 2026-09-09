# Stufe-2 Base-SHA-Freeze

`STAGE2_BASE_SHA=803153164ad111e6489c90a7a5cfa38b082c472a`

Commit: `feat(real-duel): Stufe-2-Vorbereitung — Trial-IDs, Baseline-Regression-Fix, drei neue Tasks` (2026-09-08).

Git-Tag gesetzt: `real-duel-stage2-base` → `803153164ad111e6489c90a7a5cfa38b082c472a`.

Freigegeben nach:

- 58/58 Benchmark-Unit-/Regressionstests grün (`scripts/test_*.py`).
- Sauberer Work-only Dual-Smoke (`pi-duel smoke --trial 1`): beide Kandidaten
  `success=true`, `comparable=true`, `baseline_status=clean`.
- Sauberer Plan→Work Dual-Smoke (`pi-duel smoke --trial 1 --workflow plan-work`):
  beide Kandidaten `completed=true`, `comparable=true` (`reason=baseline_clean`),
  alle 12 Gates PASS, Pi-Tool-Trace `plan_calls(1)+work_calls(5)=total_calls(6)`,
  keine Doppelzählung.

## Geltungsbereich des Freeze

Ab Festlegung des Base-SHA bis zum Ende der 36-Läufe-Serie werden **nicht**
geändert:

- Pi Instructions (`AGENTS.md`, `APPEND_SYSTEM.md`, `settings.json`)
- Permissions-/Tool-Policy (`extensions/permissions/`)
- Tool-Trace-Logik (`benchmarks/real-duel/scripts/tool_trace.py`)
- Verifier-Policy
- Plan-Quality-Bewertung (`extensions/plan-mode/plan-quality.ts`)
- Benchmark-Skripte (`benchmarks/real-duel/scripts/*`)
- Candidate-Konfiguration (`benchmarks/real-duel/candidates/*.toml`)
- Modell, Reasoning-Level
- Task-Checker (`benchmarks/real-duel/tasks/*/checker.sh`)

## Vorgehen bei einem echten P0-Benchmarkfehler während der Serie

1. Serie stoppen.
2. Problem beheben.
3. Neue Base-SHA erzeugen, dieses Dokument aktualisieren.
4. Bereits gelaufene Trials dieser Serie verwerfen bzw. klar als ungültig
   markieren (nicht mit Trials der neuen Serie vermischen — siehe
   `comparable-false-process.md` für das analoge Prinzip auf Zeilenebene).
5. Serie konsistent neu beginnen.

Trial 1 einer Serie wird nie mit Trial 3 einer anderen Harness-Version
verglichen.

## Operative Randbedingung: keine parallele interaktive Pi-Nutzung

`run-history.jsonl` (Quelle der Subagenten-/Verifier-Telemetrie, siehe
`scripts/telemetry.py::subagent_stats_from_run_history`) liegt global unter
`~/.pi/agent/` -- unabhaengig vom jeweiligen Worktree, weil
`candidates/pi-real.toml` bewusst `isolate_home=false` setzt. Waehrend ein
Benchmark-Trial laeuft, darf auf derselben Maschine keine andere interaktive
Pi-Sitzung laufen, sonst vermischt sich deren Subagenten-/Verifier-Historie
mit der Messung (cwd-Filterung schuetzt gegen andere Worktrees, aber nicht
gegen eine Sitzung, die zufaellig im selben Zeitfenster im selben Worktree
oder mit unklarer cwd laeuft).
