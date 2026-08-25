# Phase 07 – Sessions, Locks und Lifecycle

## Ziel

Sessionoperationen vollständig unterstützen und gleichzeitiges Schreiben derselben Session verhindern.

## Aufgaben

1. neue Session erstellen
2. bestehende Session öffnen und fortsetzen
3. Session wechseln und benennen
4. Session forken beziehungsweise klonen, sofern von der Runtime unterstützt
5. Compaction anbinden
6. Writer-Lock vor dem Öffnen zum Schreiben erwerben
7. Lock-Metadaten und stale Recovery implementieren
8. Lock bei kontrolliertem Schließen freigeben
9. Absturz- und Kill-Fälle testen
10. aktiven Turn beim Schließen explizit behandeln
11. Listener, Timer und Dialoge bei Sessionwechsel vollständig bereinigen

## Lock-Regeln

- genau ein Writer pro Session
- andere Sessions dürfen parallel geöffnet werden
- Zeitablauf allein macht einen Lock nicht stale
- PID und Prozessstart müssen geprüft werden
- Lockübernahme wird protokolliert
- Lockfehler darf keine Sessiondatei verändern

## Erforderliche Tests

- TUI -> freie Session
- GUI -> freie Session
- TUI hält Lock, GUI versucht dieselbe Session
- GUI hält Lock, TUI versucht dieselbe Session
- parallele Nutzung verschiedener Sessions
- Prozessabsturz
- stale Lock
- PID-Wiederverwendung
- Sessionwechsel mit laufenden Listenern
- Schließen während eines aktiven Turns
- Compaction und Fork

## Abschlusskriterien

- [ ] Alle vorgesehenen Sessionoperationen verwenden den vorhandenen Session Manager.
- [ ] Projekt- und Sessionwechsel laufen über `AgentSessionRuntime`.
- [ ] Pro Session kann nachweislich nur ein Writer aktiv sein.
- [ ] TUI und GUI respektieren denselben Lock-Mechanismus.
- [ ] Andere Sessions bleiben parallel nutzbar.
- [ ] stale Locks werden nur nach belastbarer Prozessprüfung übernommen.
- [ ] Sessionwechsel hinterlässt keine Listener, Timer oder offenen Dialoge.
- [ ] Schließen während eines Turns verlangt eine explizite Entscheidung.
- [ ] Lock- und Lifecycle-Integrationstests sind grün.

## Gate

Jede Möglichkeit parallelen Schreibens derselben Session ist ein `NO-GO` und P0-Fehler.

