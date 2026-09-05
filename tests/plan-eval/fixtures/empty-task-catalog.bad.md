# Plan

## Ziel
Der Task-Katalog soll JSON und eine Tabelle aus den vorhandenen Task-Verzeichnissen erzeugen.

## Vorgehen
In benchmarks/real-duel/scripts/list_tasks.py die Workflow-Metadaten einlesen und beide Ausgabewege aus derselben sortierten Datenstruktur erzeugen.

## Betroffene Bereiche
benchmarks/real-duel/scripts/list_tasks.py

## Verifikation
Der npm test-Lauf besteht; gezielte Aufrufe prüfen JSON und Tabelle und erwarten Exit-Code 0.

## Risiken
Unterschiedliche Sortierungen zwischen JSON und Tabelle könnten die Ausgaben inkonsistent machen.
