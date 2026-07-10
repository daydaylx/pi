---
description: Verfügbare Subagenten anzeigen
---
Tool-first Pflicht:
1. Rufe zuerst das `subagent`-Tool mit `{ "list": true, "agentScope": "user" }` auf.
2. Analysiere oder erkläre nichts, bevor der Tool-Aufruf erfolgt.
3. Falls das Tool fehlt oder 0 Agenten liefert, gib eine kurze Diagnose aus: `/tools`, `/subagent-doctor`, `PI_CODING_AGENT_DIR`, erwarteter Pfad `~/.pi/agent/agents`.
4. Fasse die gefundene Liste zusammen; übernimm keine Annahmen über nicht gefundene Agenten.
