# Phase 4 – Shortcuts und Menü-Parität

## Ziel

Das gewohnte Pi-Muscle-Memory erhalten.

Die GUI darf anders aussehen, die semantischen Aktionen sollen gleich bleiben.

## Aufgaben

### Shortcuts

Bestehende Kernshortcuts integrieren.

Insbesondere die bereits etablierten Hauptflächen:

- Work/Workflow
- Modell
- Thinking/Reasoning
- Hauptmenü/System
- weitere zentrale produktive Shortcuts aus der Baseline

### Menüs

Die bekannten Menügruppen neu rendern, z. B. als:

- Modal
- Drawer
- Popover
- Command Surface

Keine Verpflichtung zur TUI-Optik.

### Maus

Jede zentrale Aktion zusätzlich per Maus erreichbar machen.

### Ein Command, mehrere Trigger

Beispiel:

```text
Shortcut -> model.open
Click    -> model.open
```

Beide öffnen dieselbe fachliche Aktion.

## Verbot

Keine separate GUI-only Shortcut-Konfiguration, solange es nicht technisch zwingend ist.

## Abschlusskriterien

- [ ] alle priorisierten Shortcuts funktionieren in der GUI.
- [ ] kein Shortcut kollidiert still mit Electron/OS.
- [ ] unvermeidbare Konflikte sind dokumentiert.
- [ ] Menüstruktur entspricht funktional der Pi-Struktur.
- [ ] Klick und Shortcut lösen dieselben Commands aus.
- [ ] keine doppelte Geschäftslogik.
- [ ] Keyboard-only Nutzung ist möglich.
- [ ] Maus-Nutzung ist möglich.
- [ ] TUI-Shortcuts bleiben unverändert.
- [ ] Regressionstest für Shortcut-Mapping vorhanden.

## STOP-Gate

```text
STATUS: PHASE 4 COMPLETE
NEXT: PHASE 5 BLOCKED
USER APPROVAL REQUIRED
```
