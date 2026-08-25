# Test- und Paritätsmatrix

## Ziel

Die GUI gilt nicht als korrekt, wenn sie nur visuell funktioniert. Sie muss denselben fachlichen Zustand wie die TUI bedienen.

## Launcher

- `pi` startet unverändert die TUI.
- bestehende CLI-Flags behalten ihre Bedeutung.
- `pi gui` startet genau eine GUI-Instanz.
- GUI-Flags werden korrekt weitergereicht.
- Signale und Exit-Codes sind nachvollziehbar.
- fehlende GUI-Komponenten erzeugen einen klaren Fehler, ohne die TUI zu beschädigen.

## Runtime

- gleiche Pi-Paketversion in TUI und GUI
- gleiche globalen und projektbezogenen Einstellungen
- gleiche Auth- und Modellauflösung
- gleiche Extensions und Tools
- sauberer Projektwechsel
- sauberer Sessionwechsel
- keine Events alter Runtime-Generationen
- keine verdoppelten Event-Listener

## Interaktion

- Prompt
- Streaming
- Thinking
- Tool-Start, Update und Ende
- Queue
- Steer
- Follow-up
- Abort
- Compaction
- Sessionname
- Fork

## Permissions und Trust

- nicht vertrautes Projekt
- Read-only
- Project-write
- Confirm-all
- YOLO nur nach expliziter Auswahl
- Allow und Deny
- Dialog schließen
- Timeout
- verschachtelte beziehungsweise aufeinanderfolgende Anfragen
- Subagent-Anfrage

## Changes und Verification

- keine Änderungen
- eine geänderte Datei
- viele Dateien
- große Diff-Datei
- Binärdatei
- erfolgreiche Verification
- fehlgeschlagene Verification
- abgebrochene Verification
- Änderung nach erfolgreicher Verification markiert Ergebnis als veraltet
- neue erfolgreiche Verification aktualisiert den Zustand wieder

## Sessions und Locks

- TUI öffnet freie Session
- GUI öffnet freie Session
- GUI blockiert bereits von TUI beschriebene Session
- TUI blockiert bereits von GUI beschriebene Session
- andere Session bleibt gleichzeitig nutzbar
- abgestürzter Prozess hinterlässt wiederherstellbaren Lock
- PID-Wiederverwendung führt nicht zur falschen Lockübernahme

## Renderer-Sicherheit

- kein `require`
- kein direkter Node-Zugriff
- kein direkter Dateisystemzugriff
- unbekannte IPC-Nachricht wird abgelehnt
- manipulierte Payload wird abgelehnt
- Navigation auf Remote-Ziel wird blockiert
- neues Fenster wird blockiert
- externe Links durchlaufen die erlaubte Öffnungslogik

## Performance

- große Session bleibt scrollbar
- lange Streaming-Antwort blockiert den Composer nicht
- große Diff-Daten blockieren nicht den gesamten Renderer
- Tool-Event-Sturm führt nicht zu ungebremsten Re-Renders
- Sessionwechsel hinterlässt keine wachsende Listenerzahl
- Fenster bleibt bei laufender Verification bedienbar

## Plattformen

Release-Priorität:

1. Linux
2. Windows
3. macOS

Für jede unterstützte Plattform werden Start, Update/Installation, Dateidialoge, externe Links, Shortcuts, Fensterzustand und Schließen getestet.

