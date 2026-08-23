# Pi Agent — Aurora Setup

Dieses Repository enthält die lokale Pi-Konfiguration für Aurora, Berechtigungen,
LSP und einen kleinen Planmodus.

## Installation oder Aktualisierung

Zuerst die geplante Synchronisation prüfen:

```bash
npm run install:user
```

Danach die Konfiguration anwenden:

```bash
npm run install:user -- --apply
```

Standardziel ist `~/.pi/agent`; ein anderes Ziel wird mit `--target <pfad>`
angegeben. Nach der Synchronisation die Abhängigkeiten im Zielverzeichnis
installieren:

```bash
npm ci --prefix ~/.pi/agent/npm
```

Nach einem Pi-Runtime-Update die lokalen Runtime-Patches gemäß
`docs/RUNTIME_PATCHES.md` prüfen und gegebenenfalls erneut anwenden.

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
Planning-Turn ersetzt den vorhandenen Plan nur, wenn der neue Plan erfolgreich
geschrieben wurde und der Turn erfolgreich endet. Bei Fehlern oder fehlendem
Ersatz bleibt der bisherige Plan erhalten. Nach einem Wechsel von Plan zu Work
kann ein gerade in derselben Sitzung erzeugter Plan beim nächsten Work-Turn
einmalig als hilfreicher, abweichbarer Kontext erscheinen. Alte Plandateien,
fortgesetzte Sitzungen und spätere Work-Turns übernehmen ihn nie automatisch.

Der Plan ist normaler Markdown. Es gibt keine Metadaten, Step-IDs, Sidecars,
Completion, Recovery, Migration oder Planpflicht.

## Subagenten

Es gibt ausschließlich drei lokale Rollen: `investigator` für die belegte
Analyse unbekannter Bereiche, `debugger` für Reproduktion und Diagnose
unbekannter Bugs sowie `verifier` für die unabhängige Prüfung riskanter
Umsetzungen. Planung, Implementierung und finale Kommunikation bleiben beim
Hauptagenten; Delegation ist nie eine automatische Pflichtkette. Der
`verifier` ist nur bei den in `AGENTS.md` aufgezählten Risikofaktoren
verpflichtend — der Umfang eines Diffs allein löst keine Delegation aus.

Die Paket-Builtins sind in `settings.json` mit
`subagents.disableBuiltins: true` deaktiviert. Die aktive Paketkonfiguration
steht direkt in `extensions/subagent/config.json`: `toolSchemaMode: "harness"`
reduziert die akzeptierten Parameter auf SINGLE-Ausführung sowie `list`,
`status`, `stop` und `interrupt`; `toolDescriptionMode: "custom"` steuert nur
den sichtbaren Beschreibungstext; `maxSubagentSpawnsPerSession: 5` begrenzt die
Starts pro Sitzung. Es gibt keine Parallelitätskonfiguration — das Harness
führt keine parallelen Subagenten aus. Frischer Kontext und das Verbot
verschachtelter Delegation sind Eigenschaften der drei Profil-Tools.

## Berechtigungen und Freigaben

Berechtigungen sind eine reine Stufenwahl über `/permission`: `readonly`,
`project-write`, `confirm-all` und temporäres `yolo`. Gespeicherte
Einzelfreigaben gibt es nicht; ein Workflowwechsel ändert die Stufe selbst
nicht. Die Plandatei ist auf jeder Stufe automatisch erlaubtes Schreibziel.
Zusätzlich gilt bei `project-write` und `confirm-all` während `simple_plan`
oder `detailed_plan` ein technischer Mutationsschutz für den Agenten:
Schreibzugriffe außerhalb der Plandatei werden verweigert. Als Bash bleiben
nur `git status`, `git diff`, `git log` und `rg` zulässig; Projekt-Skripte
wie `npm test` oder `npm run build` sind nicht automatisch vertrauenswürdig.
`project_check` bleibt blockiert. Ausschließlich eine synchrone,
artefaktfreie Investigator-SINGLE-Delegation (`subagent({ agent:
"investigator", task: ... })`) darf passieren, wenn Repository-Bereich,
Kontrollfluss oder Änderungssurface noch unbekannt sind; Debugger, Verifier,
unbekannte Rollen, Management-Aktionen, Hintergrundläufe und `output` bleiben
blockiert. `rm`/`cp`/`mv`/`sed -i`, Redirection, Projekt-Skripte,
`npm install`/`update`/`publish`, `eslint --fix` und mutierende
`git`-Kommandos bleiben blockiert. `readonly` selbst ist unverändert
vollständig gesperrt; `yolo` hebt die Plan-Mode-Grenzen für Agenten-Tool-Aufrufe
nicht auf. Ein
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
siehe `.pi/verify.json`) aktualisiert den Verifikations-Footer, und
`project_check` ist auch der einzige Weg, diese vollständige Verifikation
überhaupt auszulösen. Das `verify`-Tool bietet nur noch die schnellen
Teilprüfungen `typecheck` und `test`. Ein direkter `bash`-Lauf derselben
Befehle oder ein Lauf aus einem Subagenten heraus lässt den Footer bei
`changed_unverified` stehen, selbst wenn der Lauf lokal grün war.

Ein unveränderter Workspace meldet `unchanged`. Das ist eine Aussage über den
Arbeitsbaum, nicht über eine bestandene Prüfung — vorher hieß dieser Zustand
`clean` und las sich wie ein Prüfergebnis.

`npm run test:runtime` (siehe „Lokale Laufzeitdaten" unten) ist bewusst kein
Teil von `verify`/CI: es prüft die explizit gewählte oder lokal erkannte
Pi-Runtime.

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
