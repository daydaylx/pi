---
description: Subagent-Workflow: Nach freigegebenem Plan eng begrenzt implementieren
argument-hint: "<freigegebener Plan und Scope>"
---
Use the `subagent` tool with a single `worker` task and `agentScope: "user"` only if the plan and file scope are already approved.

Task for `worker`:

$@

Constraints:
- Work only inside the explicitly approved file scope.
- Do not install dependencies, delete files, use sudo, push, or touch secrets.
- Stop and report a blocker if broader permissions or scope changes are needed.
- Run only relevant verification.
