---
description: Subagent-Workflow: Sicherheitsprüfung ausführen
argument-hint: "[Fokus]"
---

Tool-first Pflicht:

1. Rufe zuerst das `subagent`-Tool mit einem einzelnen `security-auditor`-Task und `agentScope: "user"` auf.
2. Auditiere nicht selbst, bevor der Tool-Aufruf erfolgt.
3. Task: Audit the current task or changes. Focus: ${@:-secrets, shell safety, permission drift, unsafe background behavior and extension risks}.
4. Falls das Tool fehlt oder 0 Agenten meldet, stoppe und gib Diagnose aus: `/tools`, `/subagent-doctor`, `/subagent-list`, `PI_CODING_AGENT_DIR`.
5. Lies keine Secret-Werte. Synthetisiere die Risiken gemäß AGENTS.md → Synthese von Subagenten-Ergebnissen.
6. Editiere keine Dateien.
