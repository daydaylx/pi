---
description: Subagent-Workflow: Sicherheitsprüfung ausführen
argument-hint: "[Fokus]"
---
Use the `subagent` tool with a single `security-auditor` task and `agentScope: "user"`.

Audit the current task or changes. Focus: ${@:-secrets, shell safety, permission drift, unsafe background behavior and extension risks}.

Do not read secret values and do not edit files.
