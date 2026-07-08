---
description: Subagent-Workflow: Reviewer, Security und Tests parallel prüfen
argument-hint: "[Fokus]"
---
Use the `subagent` tool with the `tasks` parameter and `agentScope: "user"`:

- `reviewer`: Review the current worktree changes for bugs, regressions, scope drift and missing tests. Focus: ${@:-general correctness}.
- `security-auditor`: Audit the same changes for secrets, unsafe shell, permission drift, injection and risky extension behavior.
- `test-runner`: Identify and run the most relevant non-destructive checks for the current repository. Stop if a check requires dependency installation or broader permissions.

After the parallel run, summarize the highest-priority findings and do not edit files.
