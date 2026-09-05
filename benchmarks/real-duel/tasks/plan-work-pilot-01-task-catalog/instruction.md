# Aufgabe: Task-Katalog fuer real-duel

`benchmarks/real-duel/tasks/` enthaelt mehrere Task-Verzeichnisse. Jedes hat
mindestens eine `instruction.md`, manche zusaetzlich eine `checker.sh`
und/oder eine `workflow.toml`. Letztere legt fest, welche Workflows
(`work-only`, `plan-work`) ein Task unterstuetzt -- siehe
`benchmarks/real-duel/scripts/workflow_task.py` fuer das genaue Format und
die Funktion `load(task_dir) -> WorkflowTaskConfig`. Fehlt `workflow.toml`,
unterstuetzt der Task nur `work-only` (Default von `WorkflowTaskConfig`).

Erstelle ein neues, eigenstaendiges Skript
`benchmarks/real-duel/scripts/list_tasks.py`, das alle unmittelbaren
Unterverzeichnisse von `benchmarks/real-duel/tasks/` auflistet. Nutze dafuer
`workflow_task.py` aus demselben Verzeichnis wieder (importieren, nicht das
TOML-Format erneut selbst parsen).

## Kontrakt

- Ohne Argumente: menschenlesbare Tabelle auf stdout (Format nach eigenem
  Ermessen, gut lesbar).
- Mit `--json`: ein JSON-Array auf stdout. Jedes Element ein Objekt mit
  genau diesen drei Schluesseln:
  - `"name"`: Verzeichnisname des Tasks (String)
  - `"has_checker"`: ob `checker.sh` im Task-Verzeichnis existiert (Bool)
  - `"workflows"`: die von `WorkflowTaskConfig.supported_workflows`
    gelieferte Liste als JSON-Array von Strings
    Sortiert alphabetisch nach `"name"`.
- Ein Verzeichnis unter `benchmarks/real-duel/tasks/` ohne `instruction.md`
  ist kein gueltiger Task und wird uebersprungen (nicht gelistet, kein
  Fehler, kein Absturz).

## Verifikation

`python3 benchmarks/real-duel/scripts/list_tasks.py --json` muss ohne
Fehler laufen und valides JSON mit obigem Schema ausgeben; die
menschenlesbare Standardausgabe (ohne `--json`) muss ebenfalls fehlerfrei
laufen.

## Nicht-Ziele

- Keine Aenderung an `workflow_task.py`, `pi-duel` oder bestehenden
  Task-Verzeichnissen.
- Kein zusaetzliches drittes CLI-/JSON-Framework einbinden -- die
  Python-Standardbibliothek (`argparse`, `json`) reicht.
