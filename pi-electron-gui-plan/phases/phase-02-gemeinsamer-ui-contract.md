# Phase 02 – Gemeinsamer UI-Contract

## Ziel

Eine kleine, typisierte Grenze zwischen Pi-Runtime und Frontends schaffen, ohne einen neuen State-Owner einzuführen.

## Aufgaben

1. Benötigte UI-Snapshots definieren.
2. Zulässige UI-Aktionen definieren.
3. Streaming- und Lifecycle-Events definieren.
4. Laufzeitvalidierung mit der vorhandenen Schema-Infrastruktur umsetzen.
5. Runtime-Zustände durch reine Funktionen auf UI-Zustände projizieren.
6. Priorität von Fehlern, Nutzerentscheidungen, aktiven Tools, Subagenten und normalem Status definieren.
7. Runtime-Generation und Event-Korrelation aufnehmen.
8. Contract-Versionierung beziehungsweise Kompatibilitätsprüfung festlegen.

## Zulässiger State

- fachliche Snapshots als Momentaufnahme
- IDs und Korrelationen
- Anzeigeprioritäten
- reine Ableitungen

## Verbotener State

- persistente Workflow-Kopie
- eigener Verification-Status
- eigener Sessionbaum
- eigener Permission-Entscheider
- versteckte automatische Zustandsübergänge

## Erforderliche Tests

- Schema akzeptiert gültige Payloads.
- Schema verwirft unbekannte oder manipulierte Payloads.
- Projektionen sind deterministisch.
- Snapshot kann Renderer vollständig initialisieren.
- Event einer alten Runtime-Generation wird verworfen.
- fehlende optionale Daten erzeugen einen definierten Zustand.

## Abschlusskriterien

- [ ] Alle für Version 1 benötigten Snapshots, Aktionen und Events sind typisiert.
- [ ] Jede IPC-relevante Payload besitzt Laufzeitvalidierung.
- [ ] Projektionen sind rein und besitzen Unit-Tests.
- [ ] Kein Contract-Modul schreibt Session-, Workflow- oder Verification-State.
- [ ] Runtime-Generation ist Bestandteil des Lifecycle-Vertrags.
- [ ] Der Renderer kann aus einem vollständigen Snapshot neu aufgebaut werden.
- [ ] TUI und GUI können gemeinsame Projektionen nutzen, ohne dass die TUI Electron importiert.
- [ ] Abhängigkeitsrichtung verhindert Import von Renderer-Code in Runtime oder TUI.

## Gate

`NO-GO`, wenn der Contract zu einem zweiten Runtime- oder Persistenz-Layer geworden ist.

