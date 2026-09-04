# 012 — Plan Mode hat einen kleinen technischen Mutationsschutz

## Entscheidung

Während `simple_plan` oder `detailed_plan` aktiv ist, schreibt der Agent keine
Projektdatei. Als Bash sind ausschließlich `git status`, `git diff`, `git log`
und `rg` freigegeben. Lokale Lese- und LSP-Tools bleiben nutzbar.

> **Korrektur (ADR [020](020-explicit-plan-approval.md)).** Dieser Abschnitt
> lautete ursprünglich, der Agent dürfe `.agent/plans/current-plan.md` mit
> `write`/`edit` ändern, und `verify` sei gesperrt. Beides stimmt nicht mehr
> beziehungsweise stimmte nie:
>
> - Die Plandatei liegt seit 020 nicht mehr im Projekt. Der Plan wird
>   ausschließlich über das Tool `plan_write` geschrieben, das sein Ziel selbst
>   besitzt; die Ausnahme in der Schreibgrenze entfällt ersatzlos.
> - `verify({ check: "typecheck" })` **ist** im Planmodus erlaubt und war es
>   auch schon vor 020 (`planModeVerifyTypecheckAllowed`,
>   `tests/workflow-mode/permissions.test.mjs`). Gesperrt bleiben
>   `check: "test"`, jede andere `verify`-Form und `project_check`.

Projekt-Skripte werden nicht anhand ihres Namens als sicher eingestuft:
`npm test`, `npm run build` und `project_check` bleiben gesperrt.
`subagent` bleibt ebenfalls gesperrt, mit genau einer positiv geprüften
Ausnahme: eine normale SINGLE-Ausführung des `investigator` mit nichtleerem
Task. Sie besitzt keinen `action`-, `async`-, `output`-, Context-, CWD- oder
Skill-Override; der Guard setzt fehlende Debug-Artefakte vor dem Executor auf
`false`, ein explizites `artifacts: true` bleibt blockiert. Debugger, Verifier,
unbekannte Rollen und alle Management-Aktionen können die Dateigrenze daher
nicht indirekt umgehen. Die frühere Ausnahme „`yolo` bleibt die ausdrückliche
Ausnahme“ ist durch [016](016-plan-mode-yolo-lock-and-recovery-gate.md)
ersetzt: YOLO hebt die Planmodus-Grenzen für Agenten-Tool-Aufrufe nicht mehr
auf.

## Begründung

Ein Skriptname beweist keine Lesefähigkeit; auch Test-, Build- und
Verifikationsskripte dürfen Dateien oder externe Zustände ändern. Die enge
Allowlist ist direkt prüfbar und benötigt weder einen neuen Workflow noch eine
Permission-State-Machine.

## Konsequenzen

- Der Plan bleibt bei einem fehlgeschlagenen oder ersatzlosen Planning-Turn
  erhalten; nur ein erfolgreich geschriebener, erfolgreich beendeter Turn
  ersetzt ihn. Seit 020 wird dabei ausschließlich die Plandatei der eigenen
  Sitzung zurückgesetzt.
- Tests prüfen End-to-End: Projekt-Skripte blockiert, Git-Lesen erlaubt,
  nur die artefaktfreie Investigator-SINGLE-Ausnahme erlaubt und jede andere
  Subagent-Variante blockiert. Die frühere YOLO-Ausnahme ist durch 016
  abgelöst: YOLO bleibt im Planmodus für Agenten-Tool-Aufrufe gesperrt.
- Shift+Tab bleibt die einzige Workflow-Steuerung.
