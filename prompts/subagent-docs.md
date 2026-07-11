---
description: Subagent-Workflow: Dokumentation gegen Code prüfen
argument-hint: "[Bereich]"
---

Tool-first Pflicht:

1. Rufe zuerst das `subagent`-Tool mit einem einzelnen `docs-auditor`-Task und `agentScope: "user"` auf.
2. Prüfe nicht selbst, bevor der Tool-Aufruf erfolgt.
3. Task: Check documentation against current code and configuration. Scope: ${@:-the current task and relevant docs}.
4. Falls das Tool fehlt oder 0 Agenten meldet, stoppe und gib Diagnose aus: `/tools`, `/subagent-doctor`, `/subagent-list`, `PI_CODING_AGENT_DIR`.
5. Synthetisiere das Ergebnis gemäß AGENTS.md → Synthese von Subagenten-Ergebnissen; liefere zusätzlich exakte vorgeschlagene Dokumentationstexte.
6. Editiere keine Dateien.
