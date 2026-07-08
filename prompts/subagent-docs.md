---
description: Subagent-Workflow: Dokumentation gegen Code prüfen
argument-hint: "[Bereich]"
---
Use the `subagent` tool with a single `docs-auditor` task and `agentScope: "user"`.

Check documentation against current code and configuration. Scope: ${@:-the current task and relevant docs}.

Do not edit files. Return exact proposed documentation text.
