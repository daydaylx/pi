# 012 — Plan Mode hat einen kleinen technischen Mutationsschutz

## Entscheidung

Während `simple_plan` oder `detailed_plan` aktiv ist, darf der Agent nur
`.agent/plans/current-plan.md` mit `write` oder `edit` ändern. Als Bash
sind ausschließlich `git status`, `git diff`, `git log` und `rg`
freigegeben. Lokale Lese- und LSP-Tools bleiben nutzbar.

Projekt-Skripte werden nicht anhand ihres Namens als sicher eingestuft:
`npm test`, `npm run build`, `verify` und `project_check` bleiben
gesperrt. `subagent` ist ebenfalls gesperrt, unabhängig von einem
`output`-Parameter, damit die Dateigrenze nicht indirekt umgangen werden
kann. Die frühere Ausnahme „`yolo` bleibt die ausdrückliche Ausnahme“ ist
durch [016](016-plan-mode-yolo-lock-and-recovery-gate.md) ersetzt: YOLO
hebt die Planmodus-Grenzen für Agenten-Tool-Aufrufe nicht mehr auf.

## Begründung

Ein Skriptname beweist keine Lesefähigkeit; auch Test-, Build- und
Verifikationsskripte dürfen Dateien oder externe Zustände ändern. Die enge
Allowlist ist direkt prüfbar und benötigt weder einen neuen Workflow noch eine
Permission-State-Machine.

## Konsequenzen

- Der Plan bleibt bei einem fehlgeschlagenen oder ersatzlosen Planning-Turn
  erhalten; nur ein erfolgreich geschriebener, erfolgreich beendeter Turn
  ersetzt ihn.
- Tests prüfen End-to-End: Projekt-Skripte blockiert, Git-Lesen erlaubt,
  Subagent-Umgehung blockiert. Die frühere YOLO-Ausnahme ist durch 016
  abgelöst: YOLO bleibt im Planmodus für Agenten-Tool-Aufrufe gesperrt.
- Shift+Tab bleibt die einzige Workflow-Steuerung.
