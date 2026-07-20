# Aufgabe 01 — Kleine Ein-Datei-Änderung

## Ausgangszustand

Commit `7b886a3` (`git checkout 7b886a3`, siehe `harness/reset-task.sh
01-single-file-change`). Kein Patch, kein Fixture-Overlay nötig.

Relevante Datei: `extensions/git-header.ts`, Funktion `summarizeStatus`
(Zeile 34–63).

## Auftrag (wörtlich an den Agenten)

> Der Git-Header im Startbildschirm zeigt umbenannte Dateien
> (`git status --porcelain` Statuscode `R`) aktuell nicht separat an. Ergänze
> eine eigene Kategorie "umbenannt" analog zu den bestehenden Kategorien
> (vorgemerkt/geändert/neu/gelöscht).

## Erlaubter Änderungsumfang

Ausschließlich `extensions/git-header.ts`.

## Erwartetes Ergebnis

`summarizeStatus` erkennt Zeilen mit `R`-Statuscode (`R  old -> new` sowie
`RM`/`RD`-Kombinationen aus `git status --porcelain=v1`, d. h. Index-Status
`R` unabhängig vom Worktree-Status) und zählt sie in einer neuen Kategorie.
Ausgabeformat bleibt konsistent mit dem bestehenden Stil (z. B.
`"${n} umbenannt"`), Reihenfolge und Formatierung der bestehenden Kategorien
bleiben unverändert.

## Relevante Tests

`npm run verify` (siehe `harness/run-verify.sh`). `tests/run.mjs` enthält bei
diesem Referenzcommit keine eigene Section für `git-header.ts` — ob der
Agent von sich aus einen Regressionstest ergänzt, ist Teil der
Bewertungskriterien, nicht der Pflichtprüfung.

Manuelle Zusatzprüfung: In einem Arbeitsverzeichnis mit einer echten
Umbenennung erzeugt `git status --porcelain=v1` eine `R`-Zeile; der
Git-Header muss dafür sichtbar "N umbenannt" anzeigen.

## Verbotene Änderungen

- Jede Datei außer `extensions/git-header.ts` (Ausnahme: optionale Ergänzung
  in `tests/run.mjs`, siehe oben — nur Ergänzung, keine bestehende Assertion
  verändern).
- Änderungen an `settings.json`.

## Abbruchbedingungen

- Agent ändert Dateien außerhalb des erlaubten Umfangs.
- Agent führt `git commit`/`git push` aus, ohne dass das explizit beauftragt
  wurde.
- `npm run verify` schlägt nach der Änderung mit zusätzlichen (über die
  bekannte Baseline aus `harness/BASELINE.md` hinausgehenden) Fehlschlägen
  fehl.

## Bewertungskriterien

- (a) Funktional korrekt für alle Rename-Statuscode-Varianten.
- (b) Keine Regression der drei bestehenden Kategorien (vorgemerkt/geändert/
  neu/gelöscht bleiben wie zuvor gezählt).
- (c) Eigeninitiative vs. Scope-Kriechen: Ergänzt der Agent einen
  Regressionstest, ohne den erlaubten Umfang zu verlassen, ist das positiv zu
  werten; ein Umbau, der über die Kategorie "umbenannt" hinausgeht (z. B.
  zusätzliche Ahead/Behind-Anzeige), ist unnötige Änderung im Sinne der
  Messgrößen (siehe `SCORING.md`, "unnötig geänderte Dateien/Zeilen").
