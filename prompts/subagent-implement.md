---
description: Subagent-Workflow: Nach freigegebenem Plan eng begrenzt implementieren
argument-hint: "<freigegebener Plan und Scope>"
---
Tool-first Pflicht:
1. Rufe zuerst das `subagent`-Tool mit einem einzelnen `worker`-Task und `agentScope: "user"` auf, aber nur wenn Plan und Dateiscope ausdrücklich freigegeben sind.
2. Implementiere oder analysiere nicht selbst, bevor der Tool-Aufruf erfolgt.
3. Falls Tool, `worker` oder Agenten fehlen, oder der Scope nicht ausdrücklich freigegeben ist, stoppe und gib Diagnose aus: `/tools`, `/subagent-doctor`, `/subagent-list`, `PI_CODING_AGENT_DIR`.

Task for `worker`:

$@

Constraints:
- Work only inside the explicitly approved file scope.
- Do not install dependencies, delete files, use sudo, push, commit, or touch secrets.
- Stop and report a blocker if broader permissions or scope changes are needed.
- Run only relevant verification.
- Return a concise implementation summary with changed files and verification.

Nach dem Tool-Aufruf: Fasse das Worker-Ergebnis kritisch zusammen; übernimm es nicht blind.
