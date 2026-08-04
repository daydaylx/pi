# Pi Agent — Aurora Setup

Dieses Repository enthält die lokale Pi-Konfiguration für Aurora, Berechtigungen,
LSP und einen kleinen Planmodus.

## Planmodus

Der Workflow kennt nur drei flüchtige Modi:

- `work` – normale Projektarbeit; ein vorhandener Plan ist unverbindlicher Kontext.
- `simple_plan` – schreibt ausschließlich `.agent/plans/current-plan.md`.
- `detailed_plan` – schreibt dieselbe Datei mit einem Architekturplan.

`/work` und `/go` wechseln sofort zu Work. `/plan simple` beziehungsweise
`/plan detailed` und `/workflow` wählen einen Planmodus. Existiert bereits ein
Plan, fragt die UI genau einmal: „Vorhandenen Plan überschreiben?“.

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
`maxSubagentSpawnsPerSession: 12`. Frischer Kontext und das Verbot
verschachtelter Delegation sind Eigenschaften der drei Profil-Tools.

## Berechtigungen und Freigaben

Berechtigungen sind eine reine Stufenwahl über `/permission`: `readonly`,
`project-write`, `confirm-all` und temporäres `yolo`. Gespeicherte
Einzelfreigaben gibt es nicht; ein Workflowwechsel ändert die Stufe nicht.
Planungsmodi setzen den Kontext per Prompt und erlauben technisch nur das
direkte Schreiben von `current-plan.md` — wer im Plan eine Schreibsperre will,
wählt `readonly` bewusst.

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
