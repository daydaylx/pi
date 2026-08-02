# Planmodus

`plan-mode` besitzt keinen Workflow-Lebenszyklus. Der Sessionwert ist entweder
`work`, `simple_plan` oder `detailed_plan` und wird nicht persistiert.

Planmodi setzen einen klaren Agentenkontext: Projekt untersuchen, nichts
implementieren und ausschließlich `.agent/plans/current-plan.md` schreiben.
Die Markdown-Struktur ist eine Empfehlung und wird nie validiert.

Work bindet einen vorhandenen Plan nur als hilfreichen, abweichbaren Kontext
ein. Alte `.agent/plans/*.json`-Sidecars und Archive werden ignoriert.
