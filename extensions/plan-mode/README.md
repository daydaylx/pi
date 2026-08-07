# Planmodus

`plan-mode` besitzt keinen Workflow-Lebenszyklus. Der Sessionwert ist entweder
`work`, `simple_plan` oder `detailed_plan` und wird nicht persistiert.

Planmodi setzen einen klaren Agentenkontext: Projekt untersuchen, nichts
implementieren und ausschließlich `.agent/plans/current-plan.md` schreiben.
Die Markdown-Struktur (inklusive einer Verifikation-Sektion) ist eine
Empfehlung und wird nie validiert.

`/work` startet normale Projektarbeit, ohne einen vorhandenen Plan erneut
einzubinden — ein Plan aus einer alten Aufgabe oder Session beeinflusst
spätere Work-Turns nicht automatisch. `/go` übernimmt einen vorhandenen Plan
stattdessen einmalig als Umsetzungskontext: es wechselt nach `work` und
startet direkt einen Turn, der den Plan als hilfreichen, abweichbaren Kontext
enthält. Danach ist der Plan für weitere Work-Turns wieder unverbindlich und
wird nicht erneut automatisch eingebunden. Ohne vorhandenen Plan meldet `/go`
das kurz, ohne einen Turn zu starten. Alte `.agent/plans/*.json`-Sidecars und
Archive werden ignoriert.

## Durchsetzung

Der Kontext ist ein Prompt, keine Schreibsperre — Plan Mode ist eine
Agentenverhaltensanweisung und keine technische Read-only-Sandbox: ein
Moduswechsel ändert die Berechtigungsstufe nicht. Technisch erzwungen sind
allein die Plandatei als automatisch erlaubtes Schreibziel
(`automaticallyAllowedInPlanMode`) und die harten Secret-, System-, Symlink-
und Trust-Grenzen, die in jedem Modus gelten. Wer eine echte Schreibsperre im
Planmodus will, wählt die Stufe `readonly` bewusst über `/permission`. Das ist
eine bewusste Komfortentscheidung.
