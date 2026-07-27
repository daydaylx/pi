# Project State

> Flüchtiger Arbeitsstand. Dauerhafte Entscheidungen stehen in
> `docs/CONTEXT_LEDGER.md`.

## Aktuelles Ziel

Den vereinfachten Plan-/Work-Workflow v3 mit verbindlicher Completion, vier
Berechtigungsmodi und drei lokalen Kernrollen ausliefern.

## Aktuelle Phase

Implementierung, Verifikation und abschließender Diff-/Scope-Review sind
abgeschlossen.

## Umgesetzt

- PlanSnapshot v3 mit festem Abschnittsvertrag, Planrevision und stabilen
  unsichtbaren Step-IDs.
- Atomarer Sidecar v3 ohne Lease/Heartbeat; explizite Recovery und v1/v2-
  Migration mit Backup.
- Modulare Controller für Planning, Execution, Presentation, Completion,
  Reviewer-RPC und LSP-RPC.
- Verbindliche Completion mit Diff-/Scope-Prüfung, klassifizierten Profilen,
  LSP, unabhängiger Reviewer-Antwort und Diff-Stabilitätscheck.
- Direct Tasks unter `.agent/direct-task.json`.
- Berechtigungen `readonly`, `project-write`, `confirm-all`, temporäres
  `yolo` mit konservativer Legacy-Abbildung.
- Lokale Rollen auf Planner, Worker und Reviewer reduziert; Paket-Builtins
  deaktiviert.
- Automatische Ledger-, Doom-Loop- und Edit-Metrik-Workflowtrigger entfernt;
  P3-Ledger-Gate in eine Benchmark-Fixture ausgelagert.

## Letzte Verifikation

- `npm run verify`: erfolgreich.
- Typprüfung: erfolgreich.
- Laufzeitsuite: 315 Assertions bestanden, 0 fehlgeschlagen.
- Workflow-v3-Suite: 111 Assertions bestanden, 0 fehlgeschlagen.
- LSP-Suite: 154 Assertions bestanden, 0 fehlgeschlagen.
- Diff-/Ledger-Suite: 49 Assertions bestanden, 0 fehlgeschlagen.
- Coverage-Gates: erfolgreich.
- Runtime-Reload-Test: erfolgreich.
- `node benchmarks/harness/test/p3.test.mjs`: erfolgreich.
- `git diff --check`: erfolgreich.
