# Phase 3 – Minimal funktionierende GUI

## Ziel

Eine echte, kleine Desktop-GUI betreiben, ohne den Scope zu überladen.

## Funktionsumfang

Nur:

- `pi gui` Startpfad
- Desktop-Fenster
- Verbindung zum Pi-Core
- neue Session
- Prompt senden
- Antwort streamen
- Tool-Events anzeigen
- Stop/Cancel
- Fehler anzeigen
- Session sauber schließen

## Noch nicht bauen

- komplette Sidebar
- Design-System-Politur
- Diff-Spezialansicht
- komplexe Settings
- Workflow-Menüs
- Subagent-Dashboard
- große Session-Verwaltung
- Animationen
- Themesystem-Ausbau

## UX-Minimum

Tool-Nutzung bereits kompakt darstellen:

```text
READ src/foo.ts
SEARCH verifier
EDIT src/bar.ts +12 -4
TEST npm test
```

Details dürfen expandierbar sein.

## Stabilität

GUI-Crash darf Pi-Daten nicht beschädigen.

Pi-Crash muss sichtbar gemeldet werden.

## Abschlusskriterien

- [ ] `pi` startet weiterhin TUI.
- [ ] `pi gui` startet GUI.
- [ ] echte Pi-Session funktioniert.
- [ ] Streaming funktioniert zuverlässig.
- [ ] Tool-Start/-Ende wird korrekt dargestellt.
- [ ] Cancel funktioniert.
- [ ] Fehler sind sichtbar.
- [ ] Renderer hat keinen freien Node-Zugriff.
- [ ] kein fachlicher State wird im GUI dupliziert.
- [ ] mindestens ein End-to-End-Smoke-Test existiert.
- [ ] GUI kann beendet werden, ohne Sessiondaten zu beschädigen.

## STOP-Gate

```text
STATUS: PHASE 3 COMPLETE
NEXT: PHASE 4 BLOCKED
USER APPROVAL REQUIRED
```
