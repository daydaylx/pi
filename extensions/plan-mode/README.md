# Planmodus

`plan-mode` besitzt keinen Workflow-Lebenszyklus. Der Sessionwert ist entweder
`work`, `simple_plan` oder `detailed_plan` und wird nicht persistiert.

Planmodi setzen einen klaren Agentenkontext: Projekt untersuchen, nichts
implementieren und ausschließlich `.agent/plans/current-plan.md` schreiben.
Die Markdown-Struktur (inklusive einer Verifikation-Sektion) ist eine
Empfehlung und wird nie validiert.

Shift+Tab ist die einzige normale Modusauswahl: Nach der Wahl steht der
ausgewählte Modus fest, aber es wird kein Agent-Turn gestartet. Der Editor
wartet auf die nächste echte Nutzereingabe; ein vorhandener Plan bleibt dabei
unverändert. Erst ein anschließender Planning-Turn darf ihn ersetzen.

Nach einem tatsächlich beendeten Planning-Turn kann dessen erzeugter Plan beim
Wechsel nach `work` einmalig dem nächsten echten Work-Turn als hilfreicher,
abweichbarer Kontext folgen. Dieser Handoff ist nur im Speicher verfügbar,
wird beim Verbrauch, bei einer neuen Planwahl und beim Sitzungsstart verworfen
und liest niemals beliebige bestehende Plandateien ein. Ein Work→Work-Wechsel
hat keinen Seiteneffekt. Alte `.agent/plans/*.json`-Sidecars und Archive werden
ignoriert.

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
Diagnose ist. Für Bash ist das eine bewusst eng gehaltene Klassifikation
(`isPlanModeDiagnosticCommand`): `git status`/`diff`/`log`, `rg`, `find`
(ohne `-exec`/`-delete`/…) sowie eine kleine Gruppe reiner Lesewerkzeuge
ohne Skriptcharakter (`pwd`, `ls`, `cat`, `head`, `tail`, `wc`, `stat`, `du`,
`df`, `tree`, `sort`/`uniq` ohne `-o`) sind erlaubt — kein Test, kein
Typecheck, kein Lint, kein Build und kein `git show` über Bash, unabhängig
davon, wie diagnostisch der Befehl klingt. Projekteigene Skripte
(`npm`/`pnpm`/`yarn run`/`test`/bare
Skript-Aliase) werden nie allein am Namen als sicher eingestuft, weil sie
beliebigen Lifecycle-Code ausführen können. Die `verify`- und
`project_check`-Tools laufen ausführbare Prüfungen zwar außerhalb von Bash,
sind während `simple_plan`/`detailed_plan` aber ebenfalls gesperrt (jedes
Tool außerhalb der festen Lese-Allowlist und `write`/`edit` auf die
Plandatei ist blockiert) — Tests, Typecheck, Lint und Build lassen sich im
Planmodus über keinen Weg ausführen; dafür ist ein Wechsel in den
Arbeitsmodus nötig. Der zugrunde liegende Parser
(`parseReadOnlyShell`, gemeinsam mit dem `readonly`-Pfad genutzt) lässt
keine Shell-Verkettung zu: weder `;` noch `&&`/`||`/ein alleinstehendes `&`
noch Redirections (`<`/`>`, auch nicht `2>/dev/null`) — nur eine einzelne
Pipeline aus `|`-verbundenen Segmenten ist erlaubt, jedes Segment einzeln
gegen die jeweilige Allowlist geprüft; für den `readonly`-Pfad
(`isPlanSafeCommand`) gilt derselbe Parser mit einer eigenen, unabhängigen
Segment-Allowlist. Echte Mutationen (`rm`/`cp`/`mv`/`mkdir`/`touch`/`sed -i`, sonstige
Redirection, `npm
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
