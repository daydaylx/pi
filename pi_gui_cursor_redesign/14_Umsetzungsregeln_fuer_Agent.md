# 14 – Verbindliche Umsetzungsregeln für den Coding-Agenten

## Regel 1 – Erst verstehen

Vor Änderungen:

- relevante GUI-Dateien identifizieren
- State-/Event-Fluss verstehen
- bestehende Shortcuts dokumentieren
- Abhängigkeiten zwischen TUI/Core/GUI prüfen
- bestehende Tests prüfen

Keine blinde Neuimplementierung.

## Regel 2 – Core schützen

Keine tiefen Core-Änderungen, solange die GUI-Anforderung durch Adapter, State Mapping oder Presentation Layer lösbar ist.

## Regel 3 – Kleine Schritte

Jede Phase separat implementieren.

Keine Arbeit aus späteren Phasen vorziehen, außer sie ist zwingende technische Voraussetzung.

## Regel 4 – Gates respektieren

Nach Phase 3 und Phase 7 STOP.

Kein automatisches Weiterarbeiten.

## Regel 5 – Keine Feature-Ausweitung

Nicht eigenständig hinzufügen:

- Editor
- Terminal
- Multi-Agent-Grid
- neue Workflow-Modi
- neue Provider-Logik
- neue Verifikationslogik außerhalb notwendiger UI-Anbindung

## Regel 6 – Keine redundanten Zustände

Wenn State bereits im Core existiert, keine zweite unabhängige GUI-Wahrheit aufbauen.

## Regel 7 – Fehler sichtbar lassen

Aggregation darf Fehler nicht verstecken.

## Regel 8 – Shortcuts

Bestehende Shortcuts erhalten, sofern sie nicht nachweislich mit dem neuen Layout kollidieren.

## Regel 9 – Tests pro Phase

Nach jeder Phase mindestens:

- Build
- vorhandene relevante Tests
- manuelle Kerninteraktion
- Screenshot

## Regel 10 – Bericht

Am Ende jeder Phase liefern:

- geänderte Dateien
- kurze Begründung
- Tests
- bekannte Risiken
- offene Punkte
- Screenshot-Pfad
- Aussage, ob alle Abschlusskriterien erfüllt sind
