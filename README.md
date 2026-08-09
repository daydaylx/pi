# Pi Agent — Aurora Setup

Dieses Repository enthält die lokale Pi-Konfiguration für Aurora, Berechtigungen,
LSP und einen kleinen Planmodus.

## Planmodus

Der Workflow kennt nur drei flüchtige Modi:

- `work` – normale Projektarbeit; ein vorhandener Plan ist unverbindlicher Kontext.
- `simple_plan` – schreibt ausschließlich `.agent/plans/current-plan.md`.
- `detailed_plan` – schreibt dieselbe Datei mit einem Architekturplan.

Shift+Tab ist die einzige normale Workflow-Steuerung. Es öffnet die Auswahl
Work, Schnellplan oder Architekturplan, setzt ausschließlich den Modus und
wartet dann auf die nächste echte Nutzereingabe. Die Auswahl startet keinen
Agent-Turn, erzeugt keinen synthetischen Prompt und verändert keinen
vorhandenen Plan.

Erst der nächste User-Auftrag startet den Turn im gewählten Modus. Ein
Planning-Turn darf den vorhandenen Plan dann ersetzen. Nach einem Wechsel von
Plan zu Work kann ein gerade in derselben Sitzung erzeugter Plan beim nächsten
Work-Turn einmalig als hilfreicher, abweichbarer Kontext erscheinen. Alte
Plandateien, fortgesetzte Sitzungen und spätere Work-Turns übernehmen ihn nie
automatisch.

Der Plan ist normaler Markdown. Es gibt keine Metadaten, Step-IDs, Sidecars,
Completion, Recovery, Migration oder Planpflicht.

## Subagenten

Es gibt ausschließlich drei lokale Rollen: `investigator` für die belegte
Analyse unbekannter Bereiche, `debugger` für Reproduktion und Diagnose
unbekannter Bugs sowie `verifier` für die unabhängige Prüfung nichttrivialer
Umsetzungen. Planung, Implementierung und finale Kommunikation bleiben beim
Hauptagenten; Delegation und Verifikation sind nie automatische Pflichtketten.

Die Paket-Builtins sind in `settings.json` mit
`subagents.disableBuiltins: true` deaktiviert. Die aktive Paketkonfiguration
steht direkt in `extensions/subagent/config.json`: `maxTasks: 4`,
`concurrency: 3`, `globalConcurrencyLimit: 3` und
`maxSubagentSpawnsPerSession: 5`. Frischer Kontext und das Verbot
verschachtelter Delegation sind Eigenschaften der drei Profil-Tools.

## Berechtigungen und Freigaben

Berechtigungen sind eine reine Stufenwahl über `/permission`: `readonly`,
`project-write`, `confirm-all` und temporäres `yolo`. Gespeicherte
Einzelfreigaben gibt es nicht; ein Workflowwechsel ändert die Stufe selbst
nicht. Die Plandatei ist auf jeder Stufe automatisch erlaubtes Schreibziel.
Zusätzlich gilt bei `project-write` und `confirm-all` während `simple_plan`
oder `detailed_plan` ein technischer Mutationsschutz für den Agenten:
Schreibzugriffe außerhalb der Plandatei werden verweigert, und Bash-Kommandos
des Agenten müssen nachweislich Diagnose statt Mutation sein — Tests,
Typecheck, Lint ohne `--fix`, Builds und `git status`/`diff`/`show`/`log`
bleiben erlaubt. `npm`/`pnpm`/`yarn run`/`test`/bare Aliase gelten nur als
Diagnose, wenn der Skriptname nach einer bekannten Kategorie aussieht
(`test`, `typecheck`, `lint`, `check`, `verify`, `coverage`, `audit`,
`build`, ggf. namensraum-erweitert, ohne `fix`/`write`-Marker) — ein
unbekannter Skriptname wie `npm run generate` oder `npm start` gilt nicht
automatisch als Diagnose. `rm`/`cp`/`mv`/`sed -i`/Redirection,
`npm install`/`update`/`publish`, `eslint --fix` und mutierende
`git`-Kommandos bleiben blockiert. `readonly` selbst ist
unverändert vollständig gesperrt; `yolo` bleibt bewusst unangetastet, weil
seine Wahl selbst die explizite Aufhebung der Standard-Sicherheit ist. Ein
vom Menschen selbst per `!`/`!!` eingegebener Bash-Befehl durchläuft diesen
Guard nicht — er schränkt nur den Agenten ein, nicht den Menschen an der
eigenen Tastatur. Details: `docs/decisions/012-plan-mode-mutation-guard.md`.

Harte Trust-, Secret-, Symlink-, Projekt- und Systemgrenzen bleiben auf jeder
Stufe blockiert, YOLO eingeschlossen. Dazu zählen auch Ausführungspfade
innerhalb des Projekts: Schreibzugriffe auf `.git/`, `.pi/lsp.json` und
`.pi/verify.json` müssen bestätigt werden, weil dort Geschriebenes später
ausgeführt wird.

## Verifikation

```bash
npm --prefix npm run typecheck
npm --prefix npm run test
npm --prefix npm run verify
```

`verify` schließt seit dem Audit-Gate `npm run audit:check` ein — ein lokal
grüner Lauf deckt damit dieselben Abhängigkeitsbefunde ab wie CI.

Nur ein `project_check`-Aufruf des deklarierten Pflichtprofils (`verify`,
siehe `.pi/verify.json`) aktualisiert den Verifikations-Footer. Ein direkter
`bash`-Lauf derselben Befehle — auch über den `verify`-Tool oder aus einem
Subagenten heraus — lässt den Footer bei `changed_unverified` stehen, selbst
wenn der Lauf lokal grün war.

`npm run test:runtime` (siehe „Lokale Laufzeitdaten" unten) ist bewusst kein
Teil von `verify`/CI: es prüft die tatsächlich gestartete, lokal gepatchte
Pi-Runtime unter `PI_RUNTIME_ROOT`, einem Pfad, den kein CI-Runner besitzt.

Abhängigkeiten werden nicht automatisch installiert. Commits, Pushes und
Veröffentlichungen erfolgen nur auf ausdrücklichen Auftrag.

## Lokale Laufzeitdaten

`auth.json`, `models-store.json`, `run-history.jsonl`, `pi-crash.log` und
`pi-debug.log` gehören nicht ins Repository (siehe `.gitignore`) und tragen
`0600`. Das Pi-Runtime schreibt die drei letzten selbst; legt es eine davon neu
an, ist der Modus erneut zu setzen:

```bash
chmod 600 run-history.jsonl pi-crash.log pi-debug.log
```
