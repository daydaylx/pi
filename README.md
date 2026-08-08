# Pi Agent — Aurora Setup

Dieses Repository enthält die lokale Pi-Konfiguration für Aurora, Berechtigungen,
LSP und einen kleinen Planmodus.

## Planmodus

Der Workflow kennt nur drei flüchtige Modi:

- `work` – normale Projektarbeit; ein vorhandener Plan ist unverbindlicher Kontext.
- `simple_plan` – schreibt ausschließlich `.agent/plans/current-plan.md`.
- `detailed_plan` – schreibt dieselbe Datei mit einem Architekturplan.

Shift+Tab (`/workflow`) ist die zentrale Steuerung für alle drei Modi und
deckt dabei den vollständigen fachlichen Wechsel ab, nicht nur den Moduswert:
Wahl von Schnellplan/Architekturplan verwirft einen vorhandenen Plan ohne
Rückfrage und startet direkt den Planning-Turn; Wahl von Work schaltet in
Work und übergibt einen gerade erst erstellten Plan genau einmal als
hilfreichen, abweichbaren Umsetzungskontext — nur beim tatsächlichen Wechsel
aus einem Planmodus heraus, nicht bei einem Work→Work-Wechsel und nicht bei
einem Plan aus einer alten, längst verlassenen Aufgabe oder Session.

`/plan`, `/work` und `/go` sind dünne Aliase derselben zentralen Aktion und
verhalten sich exakt wie ihre jeweilige Shift+Tab-Auswahl: `/plan simple`
beziehungsweise `/plan detailed` starten wie `/workflow` einen neuen
Planning-Turn, `/work` wechselt wie `/workflow → Work` in den Work-Modus
inklusive des einmaligen Handoffs, und `/go` tut dasselbe, meldet aber
zusätzlich kurz, wenn dabei kein Plan vorhanden war.

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
Einzelfreigaben gibt es nicht; ein Workflowwechsel ändert die Stufe nicht.
Plan Mode ist eine Agentenverhaltensanweisung und keine technische
Read-only-Sandbox: technisch erzwungen ist allein die Plandatei als
automatisch erlaubtes Schreibziel, alle anderen Schreibzugriffe folgen in
jedem Modus derselben gewählten Berechtigungsstufe wie in Work. Wer im
Planmodus eine echte Schreibsperre will, wählt `readonly` bewusst über
`/permission`.

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
