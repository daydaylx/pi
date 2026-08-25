# Sicherheit und Zustandsregeln

## Electron-Baseline

Verbindliche Einstellungen:

- `nodeIntegration` deaktiviert
- `contextIsolation` aktiviert
- Renderer-Sandbox aktiviert
- `webSecurity` aktiviert
- keine Remote-Inhalte
- strikte Content Security Policy
- Navigation auf nicht erlaubte Ziele blockiert
- neue Fenster standardmäßig blockiert
- externe Links nur über geprüfte Systemöffnung
- DevTools in Release-Builds nicht automatisch geöffnet

## IPC-Regeln

- Jeder Kanal hat einen festen Namen, Request- und Response-Typ.
- Jede Nachricht wird zur Laufzeit validiert.
- Der Renderer erhält niemals das rohe IPC-Objekt.
- Pfade werden im Main Process kanonisiert und gegen den aktiven Projektkontext geprüft.
- Fehlerantworten enthalten keine Secrets oder vollständige Umgebungsvariablen.
- Ein unbekannter Kanal oder unbekanntes Feld führt zu Ablehnung.

## Project Trust und Permissions

- Kein automatisches YOLO.
- Erhöhte Rechte benötigen eine explizite Auswahl.
- Das Schließen eines Dialogs bedeutet Ablehnung beziehungsweise Abbruch.
- Timeouts bestätigen niemals eine gefährliche Aktion.
- Permission-Entscheidungen werden von der vorhandenen Runtime beziehungsweise dem vorhandenen Permission-System getragen.
- Der Renderer zeigt Entscheidungen an, besitzt aber nicht deren fachliche Logik.

## State Ownership

| Zustand | Owner |
| --- | --- |
| aktive Session | `AgentSessionRuntime` |
| Workflow/Modus | vorhandene Runtime/Extension |
| Modelle und Auth | vorhandene Runtime-Dienste |
| Permission-Zustand | vorhandenes Permission-System |
| Verification | vorhandene Verification-Quelle |
| Changes | Runtime-/Extension-Ereignisse oder reine Ableitung |
| Subagenten | vorhandenes Subagent-System |
| Composer-Entwurf | Renderer |
| Drawer/Panelbreiten | GUI-Einstellungen |
| Sessiondatei | vorhandener Session Manager |

## Session Locks

Ein Lock enthält mindestens:

- Session-ID oder kanonischen Sessionpfad
- PID
- Frontendtyp `tui` oder `gui`
- Prozessstartzeit
- Erstellungszeit des Locks
- optional Hostkennung

Ein Lock darf nur als stale behandelt werden, wenn der zugehörige Prozess nachweislich nicht mehr aktiv ist oder die gespeicherte Prozessidentität nicht mehr passt. Zeitablauf allein reicht nicht.

## Schließen während eines aktiven Turns

Die GUI darf nicht still beenden und einen unklaren Runtimezustand hinterlassen. Vorgesehene Entscheidung:

- Turn abbrechen und schließen
- Schließen abbrechen
- optional: im Hintergrund weiterlaufen, aber nur wenn ein definierter Background-Lifecycle implementiert wurde

Version 1 darf die Hintergrundoption weglassen. Dann bleiben nur explizites Abbrechen oder Zurückkehren.

## Logging

- keine Provider-Keys
- keine vollständigen Umgebungsvariablen
- keine unredigierten Secrets aus Tool-Ausgaben
- IPC-Fehler mit Kanal und Korrelation, aber ohne sensible Payload
- Runtime-Generation und Session-ID nur in datenschutzverträglicher Form

