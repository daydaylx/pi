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

Die normalen Stufen `readonly`, `project-write`, `confirm-all` und temporäres
`yolo` bleiben erhalten. Planungsmodi erlauben sichere Analyse und das direkte
Schreiben von `current-plan.md`; andere potenziell verändernde Aktionen fragen
nach einer engen Einmal-, Sitzungs-, Projekt- oder optionalen Globalfreigabe.

Harte Trust-, Secret-, Symlink-, Projekt- und Systemgrenzen bleiben immer
blockiert. Dauerhafte Freigaben werden getrennt von Projektdateien im
Pi-Agent-Verzeichnis gespeichert und können über `/permission` eingesehen,
gelöscht oder projektweise zurückgesetzt werden.

## Verifikation

```bash
npm --prefix npm run typecheck
npm --prefix npm run test
npm --prefix npm run verify
```

Abhängigkeiten werden nicht automatisch installiert. Commits, Pushes und
Veröffentlichungen erfolgen nur auf ausdrücklichen Auftrag.
