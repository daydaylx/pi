# Phase 05 – Runtime, Chat und Streaming

## Ziel

Eine vollständige grundlegende Arbeitssitzung in der GUI ermöglichen.

## Aufgaben

1. Runtime aus dem aktuellen Projektkontext starten.
2. vollständigen Initial-Snapshot liefern.
3. Nachrichtenverlauf darstellen.
4. Text- und Thinking-Streaming verarbeiten.
5. Tool-Start, Fortschritt, Ergebnis und Fehler anzeigen.
6. Composer mit Senden und mehrzeiliger Eingabe umsetzen.
7. Queue, Steer und Follow-up anbinden.
8. laufenden Turn abbrechen.
9. Autoscroll mit manueller Scroll-Sperre umsetzen.
10. lange Sessions und Event-Stürme performant rendern.
11. Verbindungs-, Runtime- und Fatal-Fehler klar darstellen.

## UX-Regeln

- Thinking sichtbar und einklappbar
- Tool-Aktivität kompakt
- Fehler vor normalem Status
- kein zweiter Nachrichtenverlauf im GUI-State
- kein automatisches Springen zum Ende, wenn Nutzer hochgescrollt hat

## Erforderliche Tests

- leerer Sessionstart
- bestehende Session
- Text-Streaming
- Thinking-Streaming
- mehrere Tool-Aufrufe
- Tool-Fehler
- Queue während laufendem Turn
- Steer
- Follow-up
- Abort
- große Session
- verspätetes Event alter Runtime-Generation

## Abschlusskriterien

- [ ] Neue und bestehende Unterhaltung werden korrekt dargestellt.
- [ ] Streaming erzeugt keine doppelten oder verlorenen Inhalte.
- [ ] Thinking und Tools besitzen klar getrennte Darstellungen.
- [ ] Queue, Steer, Follow-up und Abort funktionieren gegen die echte Runtime.
- [ ] Renderer speichert keinen zweiten fachlichen Nachrichtenverlauf.
- [ ] Autoscroll respektiert manuelles Lesen älterer Inhalte.
- [ ] Große Sessions bleiben bedienbar.
- [ ] Alte Runtime-Events werden nicht mehr angezeigt.
- [ ] Runtime- und Tool-Fehler sind sichtbar und abbrechbar.

## Gate

`NO-GO`, wenn Nachrichten oder Tool-Zustände nur durch eine parallele GUI-State-Maschine konsistent gehalten werden können.

