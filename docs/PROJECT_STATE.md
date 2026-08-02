# Project State

Der Planworkflow wurde auf die drei flüchtigen Modi `work`, `simple_plan` und
`detailed_plan` zurückgebaut. `current-plan.md` ist freier Markdown; v3-
Status, Sidecars, Completion, Direct Tasks, Recovery und Migration sind nicht
mehr Teil der Laufzeit.

Gezielte Permission-Grants ersetzen das pauschale Blockieren von Planmodus-
Mutationen. Die laufende Verifikation und bekannte Risiken stehen in der
jeweiligen Arbeitsübergabe; dauerhafte Architekturentscheidungen gehören in
`docs/CONTEXT_LEDGER.md`.
