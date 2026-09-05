# Benchmark-Historie

`main` enthält ab dem 2026-09-04 keine Legacy-Benchmark-Infrastruktur mehr.
Alle alten Benchmarks liegen ausschließlich im Legacy-Archiv. Die neue
Benchmarkgeneration (OpenBench/Real-Duel) beginnt auf `main` sauber bei null.

## Legacy-Generationen

- **P3/P4** (`benchmarks/`) — 10 Standardaufgabentypen, Bash-/mjs-Harness
  (`reset-task.sh`, `run-verify.sh`, `collect-metrics.mjs`,
  `run-baseline.sh`), versionierter Workspace-Snapshot, P4-Performance-Tasks
  (`v2/performance-tasks/`).
- **P5 Luna** (`benchmarks/comparisons/p5-luna/`) — Pi-vs-Codex-Pilot mit
  Rohdaten, Analyse und Methodik.
- **P6 Terra/Subagents** (`benchmarks/comparisons/p6-terra-subagents/`) —
  Subagenten-Nutzenmessung.
- **Harbor Benchmark v2/v3** (`harbor-bench/`) — Harbor-basierte Pi-/Codex-
  Adapter, Environment-Locks, Task-Validierung, 0–100-Scoring
  (`SCORING_V3.md`), Telemetrie-Schema, Subagenten-Telemetrie.
- **HTTPX Hard Suite** (`harbor-bench/tasks/httpx-01`…`08`) — acht schwere
  Aufgaben gegen einen realen `encode/httpx`-Snapshot, je mit Oracle-/NOP-/
  Wrongfix-Checks.

## Archiv

```text
Tag:
benchmark-legacy-v1-v3-2026-09-04

Branch:
archive/legacy-benchmarks
```

Beide zeigen auf denselben eingefrorenen Commit
(`86dca927aa920020157e951786ffb7da5263620d`) und enthalten `benchmarks/`
und `harbor-bench/` vollständig (333 Dateien, ~16 MB). Auschecken via
`git checkout benchmark-legacy-v1-v3-2026-09-04` oder
`git worktree add <pfad> archive/legacy-benchmarks`. Details und
Vollständigkeitsprüfung: [`benchmark-archive-audit.md`](benchmark-archive-audit.md).

**Remote-Status:** Tag und Branch wurden bei der Archivierung
(2026-09-04) zunächst nur **lokal** angelegt, nicht zum Remote gepusht — ein
`git clone` von `origin` konnte das Archiv bis dahin nicht erreichen. Am
2026-09-04 nachgeholt und unabhängig verifiziert: beide Refs sind jetzt unter
`origin` (`https://github.com/daydaylx/pi.git`) vorhanden und zeigen remote
auf denselben Commit (`git ls-remote --tags/--heads origin`). Ein frischer
Clone + `git fetch --tags` erreicht das Archiv; `git show
benchmark-legacy-v1-v3-2026-09-04:harbor-bench/PILOT_REPORT.md` und
`git worktree add <pfad> archive/legacy-benchmarks` wurden aus einem
eigenständigen frischen Clone heraus erfolgreich getestet.

Nicht im Archiv (bewusst, nie versioniert): `harbor-bench/jobs/` — 245 MB
Rohtrajektorien der realen Pilotläufe. Das synthetisierte Ergebnis
(`harbor-bench/PILOT_REPORT.md`) ist im Archiv-Tag enthalten.

## Warum archiviert

Die neue Evaluation soll reale lokale Pi-/Codex-Setups vergleichen.
OpenBench/Real-Duel ersetzt die alte primäre Vergleichsstrategie. Die
Legacy-Tasks sollen keine Discovery-, Prompt- oder Evaluator-Einflüsse auf
die neue Generation erzeugen — daher die harte Trennung statt eines
`benchmarks/archive/`-Unterordners.

## Methodische Erkenntnisse (erhalten, nicht neu ausgewertet)

**Token-Semantik:** Pi und Codex berichten Input-/Cache-Werte
unterschiedlich. Cross-Provider-Vergleiche dürfen nicht direkt auf
Raw-`input` basieren. Mindestens unterscheiden: `freshInput`, `cacheRead`,
`cacheWrite`, `processedInput`, `output`, `reasoning`. (Umgesetzt in
`extensions/aurora-ui/inspector-command.ts`,
`extensions/setup-core/context-diagnostics.ts` — das ist keine
Benchmark-interne Regel, sondern gilt für jede Tokenanzeige im Produkt.)

**Error-Klassifikation:** Toolfehler mindestens unterscheiden in
Agentenfehler, Infrastruktur, Permission, erwarteter Probeversuch, Retry.

**Subagenten:** Subagent- und Verifier-Kosten getrennt messen. Aus einem
Lauf ohne Subagent-Aufruf lässt sich keine Aussage über deren Nutzen
ableiten.

**Evaluator-Regeln:** Keine versteckten Anforderungen verwenden, die im
Nutzerauftrag nicht erkennbar sind. Das Hinzufügen eines Regressionstests
darf nicht automatisch als Fail gelten, wenn der sichtbare Auftrag
Änderungen an Tests nicht verbietet.

**Statistik:** Ein Pilot mit `k=1` pro Aufgabe ist kein belastbares
Ranking.
