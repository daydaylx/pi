# Plan

## Ziel
Der Statusbalken soll einen vorgemerkten Moduswechsel sichtbar machen, damit
erkennbar ist, dass der laufende Turn noch im alten Modus arbeitet.

## Vorgehen
In extensions/plan-mode/presentation.ts das Label um den vorgemerkten Modus
erweitern und den Wert als eigenes Feld an den Frontend-Zustand geben.

## Betroffene Bereiche
extensions/plan-mode/presentation.ts, aufgerufen aus session.ts und events.ts.

## Verifikation
npm run typecheck läuft grün und der Workflow-Mode-Test erwartet das erweiterte
Label; ohne die Änderung schlägt er fehl.

## Risiken
Ein zu langes Label könnte in schmalen Terminals abgeschnitten werden.
