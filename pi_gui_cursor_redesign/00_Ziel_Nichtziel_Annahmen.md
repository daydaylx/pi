# 00 – Ziel, Nicht-Ziel und Annahmen

## Ziel

Die bestehende Pi-GUI wird strukturell überarbeitet. Der Fokus liegt auf einer task-orientierten Agentenoberfläche nach modernen Mustern, mit Cursor als primärer Referenz.

Die Oberfläche soll:

- laufende Aufgaben klar darstellen
- technische Aktivität verdichten
- Changes und Verification sichtbar in den Arbeitsfluss integrieren
- unnötige permanente Panels entfernen
- den aktuellen Task zum visuellen Mittelpunkt machen
- die bestehende Pi-Bedienlogik möglichst erhalten

## Nicht-Ziele

Nicht Teil dieses Vorhabens:

- vollständige IDE
- VS-Code-/Monaco-Klon
- eigener Terminal-Emulator
- vollständiger Git-Client
- neues Agenten-Harness
- Umbau des Pi-Cores nur für UI-Zwecke
- Multi-Agent-Grid als Pflichtfunktion
- grundlegende Änderung bestehender Shortcuts ohne Notwendigkeit

## Annahmen

- bestehende Pi-Zustände können über Events/State für die GUI abgebildet werden
- Workflows wie Work/Plan existieren bereits
- Agenten- und Verifikationsinformationen sind bereits vorhanden oder ableitbar
- Changes können taskbezogen ermittelt werden
- bestehende Shortcuts sollen weitgehend erhalten bleiben
- `pi` und `pi gui` bleiben logisch getrennte Frontends über demselben Unterbau

## Hauptprobleme der aktuellen GUI

1. große ungenutzte zentrale Fläche
2. permanenter Inspector mit zu hoher Informationsdominanz
3. doppelte bzw. dreifache Anzeige von Modell/Workflow
4. technische Zustände statt Task-Fortschritt im Vordergrund
5. Chat ist strukturell zu dominant
6. Navigation ist technisch statt arbeitsorientiert
7. Changes und Verification sind nicht Teil eines klaren Task-Lifecycles
