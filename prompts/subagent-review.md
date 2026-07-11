---
description: Subagent-Workflow: Änderungen kritisch reviewen
argument-hint: "[Fokus]"
---

Tool-first Pflicht:

1. Rufe zuerst das `subagent`-Tool mit einem einzelnen `reviewer`-Task und `agentScope: "user"` auf.
2. Analysiere den Diff nicht selbst, bevor der Tool-Aufruf erfolgt.
3. Task: Review the current worktree changes. Focus on: ${@:-bugs, regressions, scope drift, missing tests and security issues}.
4. Falls das Tool fehlt oder 0 Agenten meldet, stoppe und gib Diagnose aus: `/tools`, `/subagent-doctor`, `/subagent-list`, `PI_CODING_AGENT_DIR`.
5. Synthetisiere das Ergebnis gemäß AGENTS.md → Synthese von Subagenten-Ergebnissen.
6. Editiere keine Dateien.
