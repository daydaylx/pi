# Project State

Der Planworkflow wurde auf die drei flüchtigen Modi `work`, `simple_plan` und
`detailed_plan` zurückgebaut. `current-plan.md` ist freier Markdown; v3-
Status, Sidecars, Completion, Direct Tasks, Recovery und Migration sind nicht
mehr Teil der Laufzeit.

Berechtigungen sind eine reine Stufenwahl über `/permission`. Gespeicherte
Einzelfreigaben und die modusgekoppelten Berechtigungsdefaults sind entfernt;
ein Workflowwechsel ändert die Stufe nicht mehr. Die laufende Verifikation und
bekannte Risiken stehen in der jeweiligen Arbeitsübergabe; dauerhafte
Architekturentscheidungen gehören in `docs/CONTEXT_LEDGER.md`.

## Letzter Arbeitsstand

Aurora zeigt strukturierten Workflow-Fortschritt im Editorrahmen, bündelt die
Live-Aktivität im eigenen Widget und priorisiert Footer-Informationen je nach
Terminalbreite. Warnungen zu Kontext und LSP bleiben in der schmalen Ansicht
sichtbar; parallele Tools und Subagenten weisen auf ausgeblendete Einträge hin.
Die Footer-Ownership ist in Entscheidung 007 an Entscheidung 009 angepasst.

Parallel dazu sind drei Fähigkeiten zurückgebaut: die gespeicherten
Permission-Grants, das Performance-/Profiling-Tooling samt `agent_end`-
Frischewarner und `tool-output-guard`. Die Doku zum Performance-Tooling liegt
unter `docs/archive/performance-tools.md`.

Nächste Schritte:

1. Die Aurora-Oberfläche in einem echten Terminal mit den üblichen Breiten und
   Terminalhintergründen visuell prüfen.
2. Bei einem späteren Workflow-Provider strukturierten Fortschritt
   (`completed`/`total`) senden, damit die neue Rahmenanzeige ihn nutzen kann.
3. Den Rückbau in getrennten Commits übernehmen (Aurora, Grants, Performance,
   Tool-Output-Guard, Sonstiges).
