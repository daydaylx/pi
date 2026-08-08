# Planmodus

`plan-mode` besitzt keinen Workflow-Lebenszyklus. Der Sessionwert ist entweder
`work`, `simple_plan` oder `detailed_plan` und wird nicht persistiert.

Planmodi setzen einen klaren Agentenkontext: Projekt untersuchen, nichts
implementieren und ausschließlich `.agent/plans/current-plan.md` schreiben.
Die Markdown-Struktur (inklusive einer Verifikation-Sektion) ist eine
Empfehlung und wird nie validiert.

Shift+Tab (`/workflow`) ist die eine zentrale Implementierung des
Workflow-Wechsels: `selectWorkflow()` in `commands.ts` entscheidet, was ein
Moduswechsel fachlich bedeutet, und `/plan`, `/work`, `/go` und `/workflow`
rufen ausschließlich diese eine Funktion auf — keiner der Einstiegspunkte
besitzt eigene Business-Logik.

Wechsel in einen Planmodus verwerfen einen vorhandenen Plan ohne Rückfrage
und starten sofort einen Planning-Turn. Wechsel nach `work` übergeben einen
gerade erst erstellten Plan genau einmal als hilfreichen, abweichbaren
Umsetzungskontext — und zwar nur, wenn der vorherige Modus tatsächlich ein
Planmodus war. Ein Work→Work-Wechsel und ein Plan aus einer alten, längst
verlassenen Aufgabe oder Session lösen keinen Handoff aus; danach ist der
Plan für weitere Work-Turns wieder unverbindlich und wird nicht erneut
automatisch eingebunden. `/go` ist ein dünner Alias auf denselben Wechsel
nach `work` und meldet zusätzlich kurz, wenn dabei kein Plan vorhanden war,
statt einen Turn zu starten. Alte `.agent/plans/*.json`-Sidecars und Archive
werden ignoriert.

## Durchsetzung

Der Kontext ist ein Prompt, keine Schreibsperre — Plan Mode ist eine
Agentenverhaltensanweisung und keine technische Read-only-Sandbox: ein
Moduswechsel ändert die Berechtigungsstufe nicht. Technisch erzwungen sind
allein die Plandatei als automatisch erlaubtes Schreibziel
(`automaticallyAllowedInPlanMode`) und die harten Secret-, System-, Symlink-
und Trust-Grenzen, die in jedem Modus gelten. Wer eine echte Schreibsperre im
Planmodus will, wählt die Stufe `readonly` bewusst über `/permission`. Das ist
eine bewusste Komfortentscheidung.
