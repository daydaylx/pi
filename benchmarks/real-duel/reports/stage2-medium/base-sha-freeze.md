# Stufe-2-Medium Base-SHA-Freeze

`STAGE2_BASE_SHA=702095b76aed2840783de88364a59d3010bca03d`

Commit: `fix(audit): close Phase 4 remediation gaps, freeze medium-series prep`
(2026-09-11).

Git-Tag gesetzt: `real-duel-stage2-medium-base` → `702095b76aed2840783de88364a59d3010bca03d`.

## Freigegeben nach

- Arbeitsbaum-Voraussetzung erfüllt: kanonischer Baum sauber, Audit-
  Remediation Phase 4 (F-11/F-18/F-19) und Aurora-Coverage-Nachbesserung
  (46/46 Funktionen) sind Teil dieses Commits.
- `npm --prefix npm run verify` zweimal vollständig grün auf diesem Stand
  (Format, Typecheck, Deadcode, Coverage, Patches, Frontend-Contracts, GUI,
  Audit — Exit 0 bei jedem Lauf).

## Noch NICHT erfüllt (Gates 3+4 aus `run-matrix.md`)

- **Kein Dual-Smoke** mit `--reasoning medium` wurde ausgeführt. Muss vor
  dem ersten echten Trial erfolgreich laufen (beide Kandidaten
  `comparable=true`).
- **Keine Live-Modellläufe** dieser Serie wurden gestartet.
- Diese Session, in der der Freeze-Commit erstellt wurde, war selbst eine
  interaktive Pi-Sitzung. Vor dem Dual-Smoke und vor jedem Trial muss
  sichergestellt sein, dass **keine parallele interaktive Pi-Sitzung**
  läuft (siehe Betriebsrandbedingung unten).

## Geltungsbereich des Freeze

Ab `702095b` bis zum Ende der 36-Läufe-Medium-Serie werden **nicht**
geändert:

- Pi Instructions (`AGENTS.md`, `APPEND_SYSTEM.md`, `settings.json`)
- Permissions-/Tool-Policy (`extensions/permissions/`)
- Tool-Trace-Logik (`benchmarks/real-duel/scripts/tool_trace.py`)
- Verifier-Policy
- Plan-Quality-Bewertung (`extensions/plan-mode/plan-quality.ts`)
- Benchmark-Skripte (`benchmarks/real-duel/scripts/*`)
- Candidate-Konfiguration (`benchmarks/real-duel/candidates/*.toml`)
- Modell, Reasoning-Level (`gpt-5.6-luna`, `medium`)
- Task-Checker (`benchmarks/real-duel/tasks/*/checker.sh`)

## Vorgehen bei einem echten P0-Benchmarkfehler während der Serie

1. Serie stoppen.
2. Problem beheben.
3. Neue Base-SHA erzeugen, dieses Dokument aktualisieren.
4. Bereits gelaufene Trials dieser Serie verwerfen bzw. klar als ungültig
   markieren (nicht mit Trials der neuen Serie vermischen).
5. Serie konsistent neu beginnen.

## Operative Randbedingung: keine parallele interaktive Pi-Nutzung

`run-history.jsonl` liegt global unter `~/.pi/agent/` — unabhängig vom
jeweiligen Worktree, weil `candidates/pi-real-medium.toml` bewusst
`isolate_home=false` setzt. Während ein Benchmark-Trial läuft, darf auf
derselben Maschine keine andere interaktive Pi-Sitzung laufen, sonst
vermischt sich deren Subagenten-/Verifier-Historie mit der Messung.
