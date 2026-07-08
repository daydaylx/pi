---
description: Subagent-Workflow: Kontext sammeln und Plan erstellen, ohne Umsetzung
argument-hint: "<Aufgabe>"
---
Use the `subagent` tool with the `chain` parameter and `agentScope: "user"`:

1. Run `scout` for: $@
2. Run `planner` using the previous scout output and the original task: $@

Do not implement. Return the final plan and include any blockers.
