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

Der Kontext ist primär ein Prompt: ein Moduswechsel ändert die
Berechtigungsstufe selbst nicht, und Plan Mode bleibt keine allgemeine
Read-only-Sandbox. Technisch erzwungen sind die Plandatei als automatisch
erlaubtes Schreibziel (`automaticallyAllowedInPlanMode`), die harten Secret-,
System-, Symlink- und Trust-Grenzen, die in jedem Modus gelten — und
zusätzlich ein Planmodus-Mutationsschutz (`planModeMutationGuard` /
`planModeBashGuard` in `extensions/permissions/workflow-policy.ts`): Bei den
Stufen `project-write` und `confirm-all` verweigert er während `simple_plan`
oder `detailed_plan` jeden Schreibzugriff außerhalb der Plandatei und jedes
Bash-Kommando, das nicht nachweislich rein inspizierend ist — mit exakt der
Logik, die die Stufe `readonly` an anderer Stelle bereits verwendet, ohne
neue Muster. `readonly` selbst braucht keine gesonderte Behandlung (schon
vollständig gesperrt); `yolo` wird bewusst nicht angefasst, weil die Wahl von
YOLO selbst eine explizite, eindeutige Aufhebung der Standard-Sicherheit ist.
Details und Abwägung: `docs/decisions/012-plan-mode-mutation-guard.md`.
