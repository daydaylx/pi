---
description: Subagent-Workflow: UI/UX statisch prüfen
argument-hint: "[Bereich]"
---
Tool-first Pflicht:
1. Rufe zuerst das `subagent`-Tool mit einem einzelnen `ui-reviewer`-Task und `agentScope: "user"` auf.
2. Reviewe nicht selbst, bevor der Tool-Aufruf erfolgt.
3. Task: Review UI/UX implementation for: ${@:-responsive layout, hierarchy, long text, empty states, loading, errors and visual consistency}.
4. Falls das Tool fehlt oder 0 Agenten meldet, stoppe und gib Diagnose aus: `/tools`, `/subagent-doctor`, `/subagent-list`, `PI_CODING_AGENT_DIR`.
5. Fasse Findings kritisch zusammen und priorisiere nutzerwirksame Probleme.
6. Editiere keine Dateien.
