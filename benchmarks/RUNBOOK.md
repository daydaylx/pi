# Runbook: einen Benchmark-Lauf durchführen

Alle Befehle relativ zum Repository-Root (`/home/d/.pi/agent`) ausgeführt.

## 1. Ausgangszustand herstellen

```bash
benchmarks/harness/reset-task.sh <task-id> [worktree-basisverzeichnis]
```

Beispiel:

```bash
benchmarks/harness/reset-task.sh 01-single-file-change /tmp/pi-benchmark
```

Legt einen isolierten Git-Worktree am Referenzcommit `7b886a3` an, verlinkt
`npm/node_modules` aus dem Haupt-Checkout (kein `npm ci` pro Reset nötig) und
kopiert — falls vorhanden — `tasks/<task-id>/fixture/` nach
`<worktree>/benchmark-fixture/`. Gibt den Worktree-Pfad auf stdout aus. Der
Haupt-Checkout bleibt unberührt.

Für Aufgaben mit Fixture-Overlay (02, 03, 05, 09) liegt der eigentliche
Testgegenstand unter `<worktree>/benchmark-fixture/`, nicht unter
`<worktree>/extensions/` — siehe die jeweilige `TASK.md`.

## 2. Agent in diesem Worktree arbeiten lassen

Pi im Worktree-Pfad starten und den Auftragstext aus der jeweiligen
`TASK.md` (Abschnitt "Auftrag") als Nutzeranfrage übergeben. Notiere Beginn-
und End-Zeitstempel (ISO 8601) für die spätere `--window-start`/
`--window-end`-Filterung bei Subagenten-Metriken.

## 3. Verifikation ausführen

```bash
benchmarks/harness/run-verify.sh <worktree-pfad> > /tmp/verify-result.json
```

Setzt `PI_CODING_AGENT_DIR` auf den Worktree-Pfad (siehe
`harness/BASELINE.md`, Fehlschlag 1) und führt `npm run verify` aus. Schreibt
`{"exitCode": N, "durationMs": N, "logFile": "..."}` nach stdout und ein
vollständiges Log nach `<worktree>/.verify-output.log`.

Aufgaben mit eigenständigem Fixture-Test (02, 03, 05) nutzen stattdessen
`node <worktree>/benchmark-fixture/run-fixture-test.mjs`, da
`extensions/diff-viewer/` bei diesem Referenzcommit nicht Teil des
Haupt-`npm run verify` ist.

## 4. Metriken einsammeln

```bash
node benchmarks/harness/collect-metrics.mjs \
  --task <task-id> \
  --worktree <worktree-pfad> \
  --session <pfad-zur-haupt-session-jsonl> \
  --run-history run-history.jsonl \
  --window-start <iso-start> --window-end <iso-ende> \
  --verify-result /tmp/verify-result.json \
  --allowed-files "<komma-getrennte-liste-aus-TASK.md>" \
  > benchmarks/results/<task-id>-<zeitstempel>.json
```

Bei Aufgabe 10 (mit/ohne Subagent) zusätzlich alle Subagent-Session-Dateien
aus dem Laufzeitfenster über weitere `--session`-Flags übergeben.

Session-Dateien liegen unter `sessions/<cwd-slug>/*.jsonl` — den
tatsächlichen Dateinamen (neuester Zeitstempel im Dateinamen) vor dem
Sammelschritt notieren.

## 5. Ergebnis auswerten

`benchmarks/results/<task-id>-<zeitstempel>.json` enthält:

- `automatic.*`: vollautomatisch erhoben, siehe `SCORING.md`.
- `manualAssessment.*`: alle Felder `null` — vor Abschluss der Bewertung von
  Hand ausfüllen (Abgleich gegen "Erwartetes Ergebnis" und
  "Bewertungskriterien" in der jeweiligen `TASK.md`).

## 6. Aufräumen

```bash
git worktree remove --force <worktree-pfad>
git worktree prune
```

## Vergleich zweier Pi-Konfigurationen

Schritte 1–5 zweimal mit identischer Aufgabe, identischem Ausgangszustand,
aber unterschiedlicher Konfiguration (z. B. anderes `defaultModel` oder
andere Permission-Startstufe) durchführen. Die beiden resultierenden
`run-result.json`-Dateien nebeneinander vergleichen — es gibt bewusst keine
automatische Rangbildung oder Gesamt-Score (siehe Nicht-Ziele in
`README.md`).
