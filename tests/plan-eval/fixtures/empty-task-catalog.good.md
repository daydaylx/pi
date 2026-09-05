# Plan

## Ziel
Der Task-Katalog soll JSON und eine Tabelle aus den vorhandenen Task-Verzeichnissen erzeugen.

## Vorgehen
In benchmarks/real-duel/scripts/list_tasks.py die vorhandenen Workflow-Metadaten einlesen und beide Ausgabewege aus derselben sortierten Datenstruktur erzeugen. Für ein leeres tasks/-Verzeichnis wird ausdrücklich eine leere Liste (`rows == []`) unterstützt; die Tabelle gibt dann nur ihre Überschrift aus.

## Betroffene Bereiche
benchmarks/real-duel/scripts/list_tasks.py

## Verifikation
Der npm test-Lauf besteht; gezielte Aufrufe prüfen JSON und Tabelle jeweils mit gefülltem sowie leerem Task-Verzeichnis und erwarten Exit-Code 0.

## Risiken
Die Tabellenausgabe darf beim leeren Task-Verzeichnis weder auf `max()` noch auf den ersten Datensatz zugreifen.
