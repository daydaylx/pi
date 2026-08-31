# 13 – Testplan und Abnahme

## Funktionale Tests

### Task Lifecycle

- neuen Task starten
- Task wechseln
- Task stoppen
- Needs Input auslösen
- Verification starten
- Review-Zustand erreichen
- Task abschließen
- Fehlerfall testen

### Activity Stream

- viele Reads
- viele Commands
- mehrere Writes
- Fehler
- Warnungen
- Agentenaktivität
- langer Task
- Taskwechsel während laufender Aktivität

### Changes

- 1 Datei
- viele Dateien
- große Diff
- leere Änderung
- Taskwechsel

### Verification

- alles grün
- einzelner Fehler
- mehrere Fehler
- Check abgebrochen
- Check übersprungen
- erneute Verification

## UX-Tests

Der Nutzer muss in maximal wenigen Sekunden erkennen können:

1. Welche Aufgabe läuft?
2. Was macht Pi gerade?
3. Braucht Pi eine Entscheidung?
4. Was wurde geändert?
5. Ist Verification erfolgreich?
6. Ist Review notwendig?

## Auflösungen

Mindestens:

- 1366×768
- 1920×1080
- 2560×1440

## Performance

Prüfen:

- langer Activity Stream
- sehr viele Tool Events
- große Diffs
- mehrere Tasks
- Wechsel zwischen Tasks
- Drawer öffnen/schließen

## Regression

Bestehende Shortcuts und Workflows systematisch gegen vorherige GUI prüfen.

## Finale Abnahmekriterien

- keine offensichtlichen UI-Blocker
- keine verlorenen Kernfunktionen
- kein falscher Completed-State
- Activity Stream bleibt verständlich
- Changes/Verification korrekt
- Keyboard-Nutzung funktioniert
- keine kritischen Console-Fehler
- Build erfolgreich
- relevante Tests grün
- Abschluss-Screenshot erstellt
