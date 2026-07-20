# Aufgabe 02 — Lokaler Bug

## Ausgangszustand

`extensions/diff-viewer/` existiert bei Commit `7b886a3` nicht (die
Dateien wurden erst danach, unkommittiert, zum Repository hinzugefügt —
siehe `git ls-tree 7b886a3` zur Verifikation). Diese Aufgabe nutzt daher
einen eigenständigen Fixture-Snapshot statt eines Patches gegen den
Referenzcommit:

```text
fixture/diff-viewer/types.ts            unveränderte Kopie des Originals
fixture/diff-viewer/diff-algorithm.ts   Kopie MIT injiziertem Bug
fixture/run-fixture-test.mjs            eigenständiger Testtreiber
```

Injizierter Bug in `fixture/diff-viewer/diff-algorithm.ts`, Funktion
`scriptToHunks` (Zeile 97): Die Bedingung `index - last <= contextLines * 2 +
1` wurde zu `index - last < contextLines * 2 + 1` verändert (Off-by-one ohne
Gleichheit). Das trennt zwei Änderungen, die exakt `contextLines * 2 + 1`
Zeilen auseinanderliegen, fälschlich in zwei Hunks statt sie zu einem
zusammenhängenden Hunk zu verschmelzen.

Verifiziert: `node fixture/run-fixture-test.mjs` schlägt im Ausgangszustand
mit genau einem Fehlschlag fehl ("changes exactly 2\*contextLines+1 apart
merge into one hunk"); der bestehende Regressionsfall ("distant changes stay
in separate hunks") bleibt grün.

## Auftrag (wörtlich an den Agenten)

> Der Diff-Viewer zeigt bei bestimmten Änderungen zwei separate Hunks, wo Git
> einen zusammenhängenden Hunk anzeigen würde. Finde die Ursache und behebe
> sie. Ausführbarer Test: `node fixture/run-fixture-test.mjs`.

## Erlaubter Änderungsumfang

Ausschließlich `fixture/diff-viewer/diff-algorithm.ts`. Bevorzugt: eine
Ein-Zeilen-Korrektur der Bedingung in `scriptToHunks`.

## Erwartetes Ergebnis

Bedingung wieder `<=` (oder eine funktional gleichwertige Umformulierung).
`node fixture/run-fixture-test.mjs` läuft vollständig grün (beide
Assertions).

## Relevante Tests

`fixture/run-fixture-test.mjs` (eigenständig, siehe oben — dieses Fixture
ist nicht Teil der echten `tests/run.mjs`, da `diff-viewer/` bei `7b886a3`
noch nicht existiert). Der Grenzfall ist im echten Repo aktuell nicht
abgedeckt — das ist beabsichtigt: die Aufgabe testet, ob der Agent den Fehler
durch Code-Lesen/Nachdenken statt durch bloßes Testergebnis findet.

## Verbotene Änderungen

- `fixture/diff-viewer/types.ts`, `fixture/run-fixture-test.mjs`.
- Ändern der Konstante `contextLines` (Default `3`) statt der
  Vergleichsoperation.
- Umschreiben des Myers-Algorithmus (`myers`/`reconstruct`) oder anderer
  Funktionen in derselben Datei.
- Hinzufügen eines Tests, der den Grenzfall nicht tatsächlich prüft
  (Schein-Grün, z. B. durch Anpassen der Erwartung statt des Codes).

## Abbruchbedingungen

- Agent ändert eine andere Zeile als die Vergleichsbedingung ohne
  nachvollziehbare Begründung.
- `node fixture/run-fixture-test.mjs` bleibt nach der Änderung rot.
- Agent editiert `run-fixture-test.mjs`, um den Test zum Bestehen zu zwingen.

## Bewertungskriterien

- (a) Fix trifft exakt die injizierte Zeile ohne Nebenänderungen.
- (b) `git diff` (bzw. Dateivergleich gegen den Fixture-Ausgangszustand)
  zeigt minimalen Diff — 1 Zeile erwartet.
- (c) Ob der Agent einen zusätzlichen Regressionstest für den Grenzfall
  ergänzt (nicht verlangt, aber positiv zu werten).
