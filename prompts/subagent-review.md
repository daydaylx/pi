---
description: Subagent-Workflow: Änderungen kritisch reviewen
argument-hint: "[Fokus]"
---
Use the `subagent` tool with a single `reviewer` task and `agentScope: "user"`.

Review the current worktree changes. Focus on: ${@:-bugs, regressions, scope drift, missing tests and security issues}.

Do not edit files.
