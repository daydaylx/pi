# Aufgabe 10 — Aufgabe mit und ohne Subagent

## Ausgangszustand

Commit `7b886a3` (`harness/reset-task.sh 10-with-without-subagent`). Kein
Patch. Diese Aufgabe erfordert **zwei** identische Läufe (siehe unten), nicht
einen.

## Auftrag (wörtlich an den Agenten, identisch in beiden Läufen)

> Prüfe alle Dateien unter `extensions/shared/` auf verbliebene englische
> Code-Kommentare (Fließtext, nicht Bezeichner/Schlüsselwörter/technische
> Begriffe) und übersetze sie ins Deutsche. Behalte technische Begriffe wie
> in `docs/uebersetzungsbericht.md` beschrieben bei (API, CLI, Git, LSP,
> Modellrollen-IDs etc. bleiben unübersetzt).

Lauf A — Anweisung im System-/Auftragstext ergänzt um: "Bearbeite dies
vollständig selbst, ohne das `subagent`-Tool zu verwenden."

Lauf B — Anweisung im System-/Auftragstext ergänzt um: "Du darfst
Teilaufgaben an Subagenten delegieren, wenn das sinnvoll ist (z. B. an
`scout` für die Recherche)."

## Referenzliste (vorab fixiert, vor dem ersten Lauf)

Bei Commit `7b886a3` mindestens folgender englischer Fließtext-Kommentar
gefunden (Stichprobe, nicht notwendig abschließend — der Agent darf weitere
finden):

- `extensions/shared/ask-user-policy.ts`, Zeilen 8–14 (Docstring zu
  `digitSelection`): vollständig auf Englisch ("Resolves a single-digit
  keypress …", "Only real options (1..optionCount) are reachable …").

## Erlaubter Änderungsumfang

Ausschließlich Dateien unter `extensions/shared/`, nur Kommentartext
(Docstrings, Inline-Kommentare), keine Logikänderung, keine Änderung an
String-Literalen, die zur Laufzeit sichtbar sind (die sind bereits Teil der
abgeschlossenen UI-Übersetzung, siehe `docs/uebersetzungsbericht.md` — diese
Aufgabe betrifft nur Entwickler-Kommentare).

## Erwartetes Ergebnis

Identisch in der Substanz für beide Läufe (gleiche gefundenen
Inkonsistenzen, gleiche Übersetzungsqualität für die Referenzstelle oben).
Unterschied liegt ausschließlich in den Prozessmetriken.

## Relevante Tests

`npm run verify` grün in beiden Läufen (abzüglich bekannter Baseline aus
`harness/BASELINE.md`) — reine Kommentaränderung darf `typecheck`/`test`
nicht beeinflussen.

## Verbotene Änderungen

Änderung an Dateien außerhalb `extensions/shared/`.

## Abbruchbedingungen

- Lauf A: Das `subagent`-Tool wird dennoch aufgerufen (Regelverstoß, Lauf
  ungültig, muss wiederholt werden).
- Lauf B: Mehr als `maxSubagentSpawnsPerSession` (24, siehe
  `docs/subagents.md`) werden ausgelöst.

## Bewertungskriterien

Direkter Vergleich zwischen den zwei Läufen:

- (a) Gesamtlaufzeit.
- (b) Gesamttokenverbrauch (Haupt-Turn + delegierte Subagent-Turns aus deren
  jeweiligen Session-Logs, siehe `SCORING.md` Messgröße 7 — bei Lauf B müssen
  die Subagent-Session-Dateien zusätzlich eingesammelt werden).
- (c) Anzahl Modellaufrufe (Haupt-Turn).
- (d) Ergebnisqualität: gefundene/korrigierte Inkonsistenzen gegenüber der
  oben fixierten Referenzstelle, Vollständigkeit.

Diese Aufgabe ist die einzige im Katalog, die von Design her zwei Läufe statt
einen erfordert — ein einzelner `run-result.json` reicht hier nicht, es
werden zwei Dateien (`run-a.json`, `run-b.json`) unter `results/` erwartet.
