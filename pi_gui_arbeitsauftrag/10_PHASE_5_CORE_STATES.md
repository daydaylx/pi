# Phase 5 – Pi-spezifische Kernzustände integrieren

## Ziel

Die GUI soll nicht nur Chat können, sondern den tatsächlichen Pi-Arbeitszustand verständlich darstellen.

## Priorität 1

### Workflow / Task
- aktueller Workflow
- Aufgabe
- Phase
- Status

### Verification
- running
- ready/passed
- failed
- stale
- erforderliche Checks
- relevante Evidence

### Changes
- Dateien
- + / -
- Diff-Zugang

### Subagents
- aktiv
- queued
- done
- attention
- Investigator sichtbar

## Priorität 2

- Modell
- Thinking/Effort
- Context
- Permissions
- LSP

## Darstellung

Die GUI darf diese Zustände z. B. in einer rechten Context-Rail darstellen.

Beispiel:

```text
TASK
Repo Audit
Phase: Implementing

VERIFY
Types ✓
Tests ●

CHANGES
4 files
+82 -17

AGENTS
Investigator ●
```

## State-Regel

Kein Zustand darf aus Chattext erraten werden, wenn der Core ihn strukturiert bereitstellen kann.

## Abschlusskriterien

- [ ] Workflow kommt aus Core-State.
- [ ] Task kommt aus Core-State.
- [ ] Verification kommt aus Core-State.
- [ ] Changes kommen aus Core-State.
- [ ] Subagents kommen aus Core-State.
- [ ] Modell kommt aus Core-State.
- [ ] Thinking kommt aus Core-State.
- [ ] Permissions kommen aus Core-State.
- [ ] kein Zustand wird aus UI-Text heuristisch rekonstruiert.
- [ ] GUI und Aurora zeigen fachlich denselben Zustand.
- [ ] Divergenztests existieren.

## STOP-Gate

```text
STATUS: PHASE 5 COMPLETE
NEXT: PHASE 6 BLOCKED
USER APPROVAL REQUIRED
```
