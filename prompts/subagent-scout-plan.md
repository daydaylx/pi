---
description: Subagent-Workflow: Kontext sammeln und Plan erstellen, ohne Umsetzung
argument-hint: "<Aufgabe>"
---
Tool-first Pflicht:
1. Rufe zuerst das `subagent`-Tool auf; analysiere nicht selbst, bevor der Tool-Aufruf erfolgt.
2. Nutze `agentScope: "user"` und den `chain`-Modus:
   - `scout`: Sammle relevanten Codebase-Kontext für: $@
   - `planner`: Erstelle mit `{previous}` und der Originalaufgabe einen konkreten Umsetzungsplan für: $@
3. Falls das Tool fehlt oder 0 Agenten meldet, stoppe und gib Diagnose aus: `/tools`, `/subagent-doctor`, `/subagent-list`, `PI_CODING_AGENT_DIR`.
4. Fasse das Subagent-Ergebnis kritisch zusammen; übernimm es nicht blind.
5. Implementiere nichts und ändere keine Dateien. Nenne Blocker klar.
