# Phase 03 – Launcher `pi gui`

## Ziel

Den GUI-Start ergänzen, ohne das bestehende CLI-Verhalten zu verändern.

## Dispatch-Regel

Nur das exakte erste Argument `gui` startet die GUI. Alle anderen Argumentfolgen gehen unverändert an den bestehenden CLI-Entry-Point.

## Aufgaben

1. Aktuellen Bin- und Bootstrap-Pfad analysieren.
2. Dünnen Dispatcher vor den bestehenden CLI-Start setzen.
3. GUI-Argumente ohne Informationsverlust weiterreichen.
4. Rekursion zwischen Dispatcher und Electron verhindern.
5. Exit-Code- und Signalweiterleitung definieren.
6. Fehlerfall bei fehlender oder beschädigter GUI implementieren.
7. Sicherstellen, dass TUI ohne GUI-Build funktioniert.
8. Hilfetext nur ergänzen, wenn dies ohne Parser-Doppelung möglich ist.

## Erforderliche Tests

- `pi`
- `pi --continue`
- `pi --session <id>`
- unbekanntes Standardargument
- `pi gui`
- `pi gui --continue`
- `pi gui --session <id>`
- `pi gui --project <path>`
- GUI fehlt
- Electron beendet sich mit Fehler
- SIGINT/SIGTERM

## Abschlusskriterien

- [ ] Nur das exakte erste Argument `gui` aktiviert den GUI-Pfad.
- [ ] Alle Standardargumente erreichen unverändert den bestehenden CLI-Pfad.
- [ ] GUI-Argumente erreichen unverändert den GUI-Bootstrap.
- [ ] Es gibt keine rekursive Selbstaufrufschleife.
- [ ] Exit-Codes und Signale sind getestet.
- [ ] `pi` funktioniert bei fehlender GUI weiterhin vollständig.
- [ ] Ein GUI-Startfehler zeigt eine konkrete, handlungsfähige Meldung.
- [ ] Bestehende CLI-Regressionstests sind grün.

## Gate

`NO-GO`, wenn der Dispatcher bestehende CLI-Semantik verändert oder die TUI von Electron abhängig macht.

