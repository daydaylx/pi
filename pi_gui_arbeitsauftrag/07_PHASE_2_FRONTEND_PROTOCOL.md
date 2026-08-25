# Phase 2 – Frontend-Protokoll und semantische Commands

## Ziel

Eine stabile Grenze zwischen Pi-Core und Frontends schaffen.

Keine GUI-spezifische Agentenlogik.

## Aufgaben

### 1. Command Registry

Semantische Aktionen definieren.

Beispiele:

```text
workflow.open
workflow.set
model.open
model.set
thinking.open
thinking.set
permissions.open
permissions.set
verification.run
session.create
session.resume
inspector.open
```

### 2. State Schema

Mindestens:

```text
session
workflow
task
activity
changes
verification
subagents
model
thinking
permissions
context
lsp
```

### 3. Event Schema

Mindestens:

```text
state.snapshot
state.patch
tool.started
tool.completed
tool.failed
agent.started
agent.settled
verification.changed
session.changed
```

### 4. Shortcut Mapping

Bestehende Shortcuts auf semantische Commands abbilden.

Wichtig:

Nicht die aktuelle UI-Komponente als Ziel speichern.

### 5. Compatibility Layer

Bestehende Aurora-State-Provider möglichst wiederverwenden.

Aurora darf nicht zur Datenquelle für die GUI werden.

## Architekturtest

Nach dieser Phase muss theoretisch ein drittes Frontend auf denselben Vertrag zugreifen können.

## Abschlusskriterien

- [ ] Commands dokumentiert und typisiert.
- [ ] State dokumentiert und typisiert.
- [ ] Events dokumentiert und typisiert.
- [ ] Shortcut-Mapping dokumentiert.
- [ ] keine fachliche Logik ins Frontend verschoben.
- [ ] Aurora funktioniert weiterhin.
- [ ] `pi` funktioniert weiterhin.
- [ ] State-Schema hat klar definierte Besitzer.
- [ ] Protokoll ist versionierbar.
- [ ] Tests für zentrale Contract-Fälle vorhanden.

## STOP-Gate

```text
STATUS: PHASE 2 COMPLETE
NEXT: PHASE 3 BLOCKED
USER APPROVAL REQUIRED
```
