## Ziel

Ein eigenständiges Python-Skript `benchmarks/real-duel/scripts/list_tasks.py` soll alle gültigen unmittelbaren Task-Verzeichnisse katalogisieren, deren Checker-Existenz und unterstützte Workflows ausgeben und dabei `workflow_task.load()` wiederverwenden.

## Vorgehen

- Das Skript über `__file__` robust auf das benachbarte `tasks/`-Verzeichnis und sein eigenes `scripts/`-Verzeichnis beziehen, damit es unabhängig vom aktuellen Arbeitsverzeichnis aufrufbar ist.
- Mit `argparse` ausschließlich die optionale Flag `--json` unterstützen.
- Unmittelbare Unterverzeichnisse alphabetisch nach Verzeichnisnamen sortieren und Verzeichnisse ohne `instruction.md` still überspringen.
- Für jeden gültigen Task `workflow_task.load(task_dir)` aufrufen, `checker.sh` über seine Existenz prüfen und ein internes Datensatzformat mit genau `name`, `has_checker` und `workflows` bilden; die Workflow-Liste als Liste der gelieferten `supported_workflows` übernehmen.
- Ohne `--json` eine gut lesbare Tabelle mit Überschrift und einer Zeile pro Task ausgeben; mit `--json` ausschließlich ein JSON-Array auf stdout schreiben.
- Einen normalen `main()`-Einstieg mit passendem Shebang und Exitcode verwenden, ohne Änderungen am Workflow-Modul oder an Task-Dateien.

## Betroffene Bereiche

- Neu: `benchmarks/real-duel/scripts/list_tasks.py`
- Wiederverwendete Abhängigkeit: `benchmarks/real-duel/scripts/workflow_task.py` (nur Import und `load()`, keine Änderung)
- Datenquelle: `benchmarks/real-duel/tasks/` (nur lesend)

## Verifikation

- `python3 benchmarks/real-duel/scripts/list_tasks.py --json` aus dem Repository-Wurzelverzeichnis ausführen und prüfen, dass stdout valides JSON ist, ein Array liefert, alphabetisch nach `name` sortiert ist und jedes Objekt genau die drei vereinbarten Schlüssel sowie die korrekten Bool-/String-Array-Typen enthält.
- Den Aufruf ohne Argumente ausführen und prüfen, dass die menschenlesbare Tabelle fehlerfrei erscheint.
- Einen zusätzlichen Aufruf aus einem anderen aktuellen Arbeitsverzeichnis in Betracht ziehen bzw. durchführen, um die Pfadauflösung über `__file__` zu bestätigen.

## Risiken

- Fehlerhafte oder ungültige vorhandene `workflow.toml`-Inhalte werden von `workflow_task.load()` als Fehler propagiert; das entspricht der geforderten Wiederverwendung und wird nicht durch ein zweites TOML-Parsing verdeckt.
- Die JSON-Ausgabe darf keine zusätzlichen Diagnosezeilen auf stdout enthalten, da sie maschinenlesbar sein muss.
- Die Workflow-Reihenfolge wird nicht eigenmächtig verändert, weil der Vertrag ausdrücklich die von `supported_workflows` gelieferte Liste verlangt; nur die Task-Datensätze werden nach `name` sortiert.
