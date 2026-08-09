# Planmodus

`plan-mode` besitzt keinen Workflow-Lebenszyklus. Der Sessionwert ist entweder
`work`, `simple_plan` oder `detailed_plan` und wird nicht persistiert.

Planmodi setzen einen klaren Agentenkontext: Projekt untersuchen, nichts
implementieren und ausschließlich `.agent/plans/current-plan.md` schreiben.
Die Markdown-Struktur (inklusive einer Verifikation-Sektion) ist eine
Empfehlung und wird nie validiert.

Shift+Tab (`/workflow`) ist die reine Modusauswahl: Nach der Wahl steht der
ausgewählte Modus fest, aber es wird kein Agent-Turn gestartet. Der Editor
wartet auf die nächste Nutzereingabe; ein vorhandener Plan bleibt dabei
unverändert und wird nicht automatisch an Work übergeben.

`selectWorkflow()` in `commands.ts` enthält dagegen die expliziten Aktionen
von `/plan`, `/work` und `/go`. Wechsel in einen Planmodus verwerfen einen
vorhandenen Plan ohne Rückfrage und starten sofort einen Planning-Turn.
Wechsel nach `work` übergeben einen gerade erst erstellten Plan genau einmal
als hilfreichen, abweichbaren Umsetzungskontext — und zwar nur, wenn der
vorherige Modus tatsächlich ein Planmodus war. Ein Work→Work-Wechsel und ein
Plan aus einer alten, längst verlassenen Aufgabe oder Session lösen keinen
Handoff aus; danach ist der Plan für weitere Work-Turns wieder unverbindlich
und wird nicht erneut automatisch eingebunden. `/go` ist ein dünner Alias auf
denselben Wechsel nach `work` und meldet zusätzlich kurz, wenn dabei kein
Plan vorhanden war, statt einen Turn zu starten. Alte
`.agent/plans/*.json`-Sidecars und Archive werden ignoriert.

## Durchsetzung

Der Kontext ist primär ein Prompt: ein Moduswechsel ändert die
Berechtigungsstufe selbst nicht, und Plan Mode bleibt keine allgemeine
Read-only-Sandbox. Technisch erzwungen sind die Plandatei als automatisch
erlaubtes Schreibziel (`automaticallyAllowedInPlanMode`), die harten Secret-,
System-, Symlink- und Trust-Grenzen, die in jedem Modus gelten — und
zusätzlich ein Planmodus-Mutationsschutz (`planModeMutationGuard` /
`planModeBashGuard` in `extensions/permissions/workflow-policy.ts`) für den
Agenten: Bei den Stufen `project-write` und `confirm-all` verweigert er
während `simple_plan` oder `detailed_plan` jeden Schreibzugriff außerhalb der
Plandatei und jedes Bash-Kommando des Agenten, das nicht nachweislich eine
Diagnose ist. Für Bash ist das eine eigene, bewusst großzügigere Klassifikation
(`isPlanModeDiagnosticCommand`) als `readonly`s Allowlist: Tests, Typecheck,
Lint ohne `--fix`, Builds sowie `git status`/`diff`/`show`/`log` sind
erlaubt. Für `npm`/`pnpm`/`yarn run`/`test`/bare Skript-Aliase gilt das nur,
wenn der Skriptname selbst nach einer der bekannten Diagnose-Kategorien
aussieht (`test`, `typecheck`, `lint`, `check`, `verify`, `coverage`,
`audit`, `build`, optional mit `:`/`-`-Namensraum wie `test:coverage`, ohne
einen `fix`/`write`-Marker wie in `lint:fix`) — ein beliebiger, unbekannter
Skriptname (`npm run generate`, `npm start`, eigene Aliase) gilt nicht als
nachweislich diagnostisch und bleibt blockiert; projekteigene, bewusst
vertrauenswürdige Prüfungen laufen dafür über `project_check`. Echte
Mutationen (`rm`/`cp`/`mv`/`mkdir`/`touch`/`sed -i`/Redirection, `npm
install`/`update`/`ci`/`publish`/`exec`, `eslint --fix`, `git commit`/`push`/
`add`/`checkout`/`reset`/`clean`/`merge`/…) bleiben blockiert. `readonly`
selbst braucht keine gesonderte Behandlung (schon vollständig gesperrt);
`yolo` wird bewusst nicht angefasst, weil die Wahl von YOLO selbst eine
explizite, eindeutige Aufhebung der Standard-Sicherheit ist. Der Guard läuft
ausschließlich für den Agenten (`tool_call`, das `bash`-Tool) — ein vom
Menschen selbst per `!`/`!!` eingegebener Befehl (`user_bash`) durchläuft ihn
nicht, da Plan Mode den Agenten am impliziten Implementieren hindern soll,
nicht den Menschen an der eigenen Tastatur einschränken. Details und
Abwägung: `docs/decisions/012-plan-mode-mutation-guard.md`.
