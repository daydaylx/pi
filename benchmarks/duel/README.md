# Pi-vs-Codex Live-Duell

Real-World Personal Harness Comparison: dieselbe echte Aufgabe, derselbe
Ausgangscommit, Pi und Codex jeweils mit ihrer realen Konfiguration
(Extensions, Subagenten, Verifier, Permissions bei Pi; `config.toml` bei
Codex). Es wird nichts angeglichen, deaktiviert oder begrenzt. Kein Scoring,
kein Sieger.

## Benutzung

```bash
benchmarks/duel/duel start --repo /pfad/zum/repo --prompt task.md [--slug bugfix]
benchmarks/duel/duel report 001     # comparison.md neu erzeugen
benchmarks/duel/duel list
```

Optional: `--pi-provider`, `--pi-model`, `--codex-model`. Ohne Angabe gelten die
realen Defaults; sie werden im Report dokumentiert.

Voraussetzung: Das Quell-Repo hat keine uncommitteten Änderungen (die Worktrees
starten vom HEAD-Commit). Während eines Laufs keine parallele interaktive
Pi-Sitzung im selben Worktree nutzen.

## Ablauf

1. Ausgangszustand erfassen (`metadata.json`, `prompt.md` byte-identisch).
2. Pi in frischem Git-Worktree vom Ausgangscommit; Logs, Diff, Usage sichern.
3. Worktree entfernen, **neuer** Worktree vom selben Commit (HEAD und
   Sauberkeit werden geprüft) — keine Übernahme von Pi-Änderungen.
4. Codex im neuen Worktree; gleiche Sicherung.
5. `comparison.md` mit Fakten; qualitative Abschnitte werden nach dem Lauf
   gemeinsam ausgefüllt.

Ein Fehler in einem Arm (`error.json`) zerstört die Daten des anderen nicht.

## Ablage

`duels/NNN-slug/` im Repo-Root (gitignored):
`metadata.json`, `prompt.md`, `comparison.md`,
`pi/` und `codex/` je mit `logs/`, `diff.patch`, `status.txt`, `commits.txt`,
`files.txt`, `usage.json`, `result.md`.

## Usage

Vorhandene Logs, keine neue Telemetrie: Pi-JSON-Stream (Hauptagent),
`codex exec --json`, und für Pi-Subagenten/Verifier
`~/.pi/agent/run-history.jsonl` (gefiltert nach Worktree-cwd und Zeitfenster).
Pi Gesamt = Main + Subagenten (Verifier ist darin enthalten und wird nicht
doppelt gezählt). Nicht gemessene Werte bleiben „nicht messbar“; Codex meldet
keine Kosten. Subagenten-interne Tool Calls sind nicht enthalten.

## Tests

```bash
npm --prefix npm run test:benchmark   # bzw. python3 -m unittest discover -s benchmarks/duel
```

Das frühere OpenBench-basierte System (`pi-duel`, Stage2, Gates) ist entfernt;
es bleibt über die Git-Historie und `docs/benchmark-history.md` nachvollziehbar.
Die historischen Rohdaten liegen unverändert unter `benchmarks/real-duel/reports/`.
