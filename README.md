# Pi Core CLI/TUI — Aurora Setup

Pi is the core CLI/TUI agent runtime setup. Dieses Repository enthält die lokale
Pi-Konfiguration für Aurora, Berechtigungen, LSP, Verification und Plan Mode.
Die separate Desktop-Anwendung `daydaylx/pi-gui` ist ausschließlich ein
Frontend für denselben Pi-Core.

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
angegeben. Die Synchronisation enthält auch `APPEND_SYSTEM.md` (phasenbasierte
Kommunikationsregeln) und `prompts/`, damit Checkout und Installation dieselbe
aktive Konfiguration verwenden. Nach der Synchronisation die Abhängigkeiten im
Zielverzeichnis installieren:

```bash
npm ci --prefix ~/.pi/agent/npm
npm --prefix ~/.pi/agent run build
```

Nach einem Pi-Runtime-Update die lokalen Runtime-Patches gemäß
`docs/RUNTIME_PATCHES.md` prüfen und gegebenenfalls erneut anwenden.

Externe Frontends starten `bin/pi-frontend` und verwenden ausschließlich die in
`docs/frontend-api.md` dokumentierte, versionierte JSONL-Schnittstelle.

## Planmodus

Der Workflow kennt nur drei flüchtige Modi: `work`, `simple_plan` und
`detailed_plan`. Shift+Tab ist die einzige normale Workflow-Steuerung: Die
Auswahl Work, Schnellplan oder Architekturplan setzt nur den Modus und wartet
auf die nächste echte Nutzereingabe. Sie startet keinen Agent-Turn und ändert
keine Plan-Datei.

Ein Planning-Turn schreibt ausschließlich über `plan_write` in die
sitzungsbezogene Runtime-Ablage
`~/.pi/agent/plans/<workspace-key>/<session-id>.md` (bzw. unter
`PI_CODING_AGENT_DIR`), nie in den Arbeitsbaum. Nach einem fertigen Plan gibt
es drei explizite Wege: ausführen, weiter planen oder ohne Ausführung nach Work
wechseln. Nur „Plan ausführen“ bzw. `/plan-approve` startet einen Work-Turn
mit dem unveränderten, hashgebundenen Plan; ein bloßer Wechsel nach Work führt
nichts aus.

Der Plan bleibt unverbindlicher Markdown-Kontext und ersetzt weder
Berechtigungsstufen noch die harten Trust-, Recovery- oder Verifier-Grenzen.
Details zu Ablage, Freigabe, Editieren und der Qualitätsprüfung stehen in
[`extensions/plan-mode/README.md`](extensions/plan-mode/README.md).

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
nicht. Subagenten-Delegationen (`subagent`) sind auf `project-write`,
`confirm-all` und `yolo` ohne Bestätigung erlaubt (Entscheidung 018);
`readonly` bleibt vollständig gesperrt. Planmodus-Guard,
Verifier-Vertragsprüfung und die harten Grenzen gelten unverändert weiter.

Während `simple_plan` oder `detailed_plan` verweigert der technische
Mutationsschutz für Agenten auf `project-write`, `confirm-all` und `yolo`
jeden Schreibzugriff in den Arbeitsbaum; nur `plan_write` darf den
sitzungsbezogenen Plan speichern. Positiv bekannte Plan-Fähigkeiten sind
`read`, `grep`, `find`, `ls`, `recovery_check`, `ask_user`, lokale LSP-Tools,
vertrauensgebundene read-only-Webtools, `plan_write` sowie
`verify({ check: "typecheck" })`. `project_check` und Tests bleiben blockiert.

Für Bash sind nur `git status`/`diff`/`log`, `rg`, `find` ohne mutierende
Optionen und die reinen Lesewerkzeuge `pwd`, `ls`, `cat`, `head`, `tail`, `wc`,
`stat`, `du`, `df`, `tree`, `sort` und `uniq` zulässig. Projekt-Skripte,
Redirections, Shell-Verkettungen und mutierende Git-Kommandos bleiben
blockiert. Eine artefaktfreie Investigator-SINGLE-Delegation ist nur bei
unbekanntem Repository-Bereich, Kontrollfluss oder Änderungssurface erlaubt;
Debugger, Verifier, Management-Aktionen, Hintergrundläufe und Ausgabe-Dateien
bleiben im Planmodus gesperrt. `readonly` selbst bleibt vollständig gesperrt;
`yolo` hebt die Plan-Mode-Grenzen für Agenten-Tool-Aufrufe nicht auf. Ein vom
Menschen selbst per `!`/`!!` eingegebener Bash-Befehl durchläuft diesen Guard
nicht. Details: `docs/decisions/012-plan-mode-mutation-guard.md`.

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
