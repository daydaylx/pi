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
- Atomarer Sidecar v3 ohne Lease/Heartbeat; v1/v2-Migration mit Backup.
  Eine unterbrochene Ausführung meldet plan-mode beim Sitzungsstart und
  verweist auf `/work`.
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
- Genau ein kanonischer Workflow-Status (`WorkflowStatus` in
  `plan-mode/store.ts`). `WorkflowPhase` und `WorkflowLifecycle` sind entfernt;
  Legacy-Werte kommen nur noch in `legacyStatus()` der Migration vor.
- Abgehängte Module entfernt: plan-menu, post-plan-card, workflow-presentation,
  workflow-hooks, workflow-commands, workflow-settlement, ledger-checkpoint,
  plan-mode/state.ts, doom-loop, edit-fallback, edit-metrics, recovery-check
  und die beiden zugehörigen Capability-Busse.
- `Super+M` (Modellwahl) wiederhergestellt; im Auto-Modus folgt die Denktiefe
  jetzt einem Workflow-Wechsel. Der Workflow-Status ist während Planung und
  Review sichtbar und wird beim Sitzungsende zurückgesetzt.
- Die Test-Suite `workflow` läuft wieder in `npm test`; sie war in
  `run-all.mjs` nicht eingetragen und damit wirkungslos.
- Vertragsabweichungen sind in `docs/CONTEXT_LEDGER.md` protokolliert
  (Umbauvertrag §13.14).
- `setup-core/task-contract.ts` entfernt: `.agent/task-contract.json` wurde nie
  geschrieben, der Scope-Drift-Zweig des Gates war unerreichbar. Der wirksame
  Matcher liegt jetzt in `plan-mode/scope.ts`; die erzwingbare Scope-Prüfung
  bleibt der required-Check in `plan-mode/completion.ts`.
- `plan-mode/utils.ts` aufgelöst (1043 Z., 43 von 46 Exporten ungenutzt):
  `isPlanFilePath` nach `store.ts` (nutzt dort das vorhandene `assertSafePath`),
  `readArtifactTriState` nach `shared/context-ledger.ts`. Die doppelten
  Pfadkonstanten entfallen damit.
- `requestLsp` nach `plan-mode/lsp-bridge.ts`, `completionOverrideReport` nach
  `completion.ts` verschoben.
- `store.ts` (1212 Z.) nach Verantwortlichkeiten aufgeteilt:
  `store/{paths,atomic-files,types,locks,workflow-state,archive,migration,
  direct-task}.ts` mit `store/index.ts` als Barrel. Keine funktionale Änderung,
  keine zyklischen Importe, `assertSafePath` bleibt einzige Quelle der
  Pfadsicherheit.

## Letzte Verifikation

- Typprüfung: erfolgreich.
- Laufzeitsuite: 284 Assertions bestanden, 0 fehlgeschlagen.
- Workflow-Suite: 188 Assertions bestanden, 0 fehlgeschlagen.
- Workflow-v3-Suite: 111 Assertions bestanden, 0 fehlgeschlagen.
- LSP-Suite: 154 Assertions bestanden, 0 fehlgeschlagen.
- Diff-/Ledger-Suite: 46 Assertions bestanden, 0 fehlgeschlagen.
- Coverage-Gates: erfolgreich.
- Runtime-Reload-Test: erfolgreich.
- `git diff --check`: erfolgreich.
- Installer-Dry-Run: erfolgreich (132 Dateien).
- Nicht ausgeführt: Fresh-Checkout-Reproduktion,
  `benchmarks/harness/test/p3.test.mjs`.
