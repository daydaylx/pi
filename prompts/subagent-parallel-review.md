---
description: Subagent-Workflow: Reviewer, Security und Tests parallel prüfen
argument-hint: "[Fokus]"
---

Tool-first Pflicht:

1. Rufe zuerst das `subagent`-Tool mit `tasks` und `agentScope: "user"` auf.
2. Analysiere nicht selbst, bevor der Tool-Aufruf erfolgt.
3. Starte diese unabhängigen Tasks parallel:
   - `reviewer`: Review the current worktree changes for bugs, regressions, scope drift and missing tests. Focus: ${@:-general correctness}.
   - `security-auditor`: Audit the same changes for secrets, unsafe shell, permission drift, injection and risky extension behavior.
   - `test-runner`: Identify and run the most relevant non-destructive checks for the current repository. Stop if a check requires dependency installation or broader permissions.
4. Falls das Tool fehlt oder 0 Agenten meldet, stoppe und gib Diagnose aus: `/tools`, `/subagent-doctor`, `/subagent-list`, `PI_CODING_AGENT_DIR`.
5. Synthetisiere gemäß AGENTS.md → Synthese von Subagenten-Ergebnissen (insbesondere Konfliktgewichtung bei parallelen Ergebnissen).
6. Editiere keine Dateien.
