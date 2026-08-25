# Phase 6 – GUI-UX bewusst neu gestalten

## Ziel

Jetzt darf die Oberfläche deutlich weg vom CLI-Gefühl.

Vorher nicht.

## Designziele

- Chat ist Hauptfläche.
- Tool-Aktivität ist sekundär.
- wichtige Zustände sind sichtbar, aber nicht dominant.
- keine Informationswand.
- wenige permanente Flächen.
- Details auf Abruf.
- Keyboard-first bleibt möglich.
- Maus ist vollwertig.
- responsive Fenstergrößen.
- klare visuelle Hierarchie.

## Empfohlene Grundstruktur

```text
┌──────────────────────────────────────────────────────────────┐
│ Pi       Projekt                  Modell · Thinking          │
├────────────┬───────────────────────────────┬─────────────────┤
│ Navigation │ Conversation                  │ Context         │
│            │                               │                 │
│ Chat       │                               │ Task            │
│ Changes    │                               │ Verify          │
│ Agents     │                               │ Changes         │
│ Verify     │                               │ Agents          │
│ Sessions   │                               │ Context         │
│ Files      │                               │                 │
├────────────┴───────────────────────────────┴─────────────────┤
│ Eingabe                                                      │
└──────────────────────────────────────────────────────────────┘
```

## Tool-UX

Default kompakt:

```text
✓ 8 Reads
✓ 3 Searches
● 1 Test
1 Edit +12 -4
```

Bei Bedarf:

```text
[Activity anzeigen]
```

## Nicht überbauen

Keine UI-Fläche nur weil sie technisch möglich ist.

Jede permanente Fläche muss einen klaren Nutzwert haben.

## Abschlusskriterien

- [ ] Chat ist visuell dominant.
- [ ] Tool-Ausgaben dominieren nicht mehr.
- [ ] zentrale Zustände sind ohne Commands erreichbar.
- [ ] gleiche Aktionen weiterhin über Shortcut erreichbar.
- [ ] Layout funktioniert auf kleinen und großen Fenstern.
- [ ] keine zentrale Funktion ist nur per Maus erreichbar.
- [ ] keine zentrale Funktion ist nur per Shortcut erreichbar.
- [ ] visuelle Zustände haben eindeutige Bedeutung.
- [ ] kein unnötiges dauerhaftes Dashboard-Overload.
- [ ] UX wurde mit realen Pi-Sessions getestet.

## STOP-Gate

```text
STATUS: PHASE 6 COMPLETE
NEXT: PHASE 7 BLOCKED
USER APPROVAL REQUIRED
```
