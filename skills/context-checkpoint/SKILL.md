---
name: context-checkpoint
description: Create or update a compact persistent project work checkpoint. Use after analysis, before a long implementation, after a completed phase, before a model switch, before manual compaction, or before moving to a new session.
---

# Context Checkpoint

Create a verified snapshot of the current work without copying the conversation.

## Procedure

1. Determine the project root with Git when available; otherwise use the current working directory.
2. Read `docs/PROJECT_STATE.md` only when continuing an existing task. Verify every retained statement against the current request, repository state, and completed checks.
3. Collect only:
   - current goal and non-goals
   - active constraints
   - decisions and still-relevant rejected options with reasons
   - files read and changed
   - known errors and failed tests
   - successful verification
   - open risks
   - exactly three concrete next steps
4. Update `docs/PROJECT_STATE.md` only when the active permission mode allows documentation writes. Otherwise return the checkpoint in the response without writing.
5. Preserve these top-level sections and keep the file below 250 lines:
   `Aktuelles Ziel`, `Aktuelle Phase`, `Erledigt`, `Offene Aufgaben`, `Aktive Entscheidungen`, `Geänderte Dateien`, `Bekannte Fehler`, `Letzte Verifikation`, `Risiken`, `Nächste drei Schritte`, `Letzte Aktualisierung`.
6. Put non-goals and constraints under `Aktuelles Ziel`; put chosen and rejected options under `Aktive Entscheidungen`.

## Guardrails

- Do not store complete tool output, logs, chat excerpts, secrets, credentials, environment values, or private session content.
- Do not retain stale decisions without checking them.
- Mark missing or uncertain information explicitly; never invent it.
- Do not change code or configuration as part of the checkpoint.
- Do not start compaction automatically. State visibly that the checkpoint is ready before suggesting `/compact`.
