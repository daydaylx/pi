# Decisions

Ein Architecture-Decision-Log. Jede Datei ist für ihr Thema kanonisch; neuere
Entscheidungen verweisen auf ältere, wenn sie sie ersetzen oder ändern.

## Aktive Entscheidungen

- [007](007-aurora-single-ui-owner.md) — Aurora ist einziger aktiver UI-Besitzer
- [008](008-context-ledger-is-documentation.md) — Das Context Ledger ist Dokumentation, keine Laufzeitkomponente
- [009](009-aurora-owns-the-footer.md) — Aurora besitzt auch die Fußzeile
- [010](010-compaction-recent-context-budget.md) — Recent-Context-Budget bleibt bei 12 KiB
- [011](011-investigator-debugger-verifier.md) — Investigator, Debugger, Verifier ersetzen Planner, Worker, Reviewer
- [012](012-plan-mode-mutation-guard.md) — Plan Mode bekommt einen technischen Mutationsschutz
- [013](013-aurora-keeps-the-native-editor.md) — Aurora behält Pis nativen Editor (ersetzt den Editor-Teil von 009)
- [014](014-reduced-subagent-tool-surface.md) — Die reduzierte Subagent-Tool-Surface ist ein eigener Schalter
- [015](015-verifier-delegation-guard.md) — Verifier-Delegationen werden technisch erzwungen, nicht appelliert
- [016](016-plan-mode-yolo-lock-and-recovery-gate.md) — YOLO-Sperre im Planmodus und Recovery-Gate vor Schreibzugriffen

## Historische, ersetzte Entscheidungen

- [005](005-three-agent-model.md) — Drei lokale Rollen: Planner, Worker,
  Reviewer (vollständig ersetzt durch 011)

## Nummernlücke 001–004, 006

Diese Nummern waren vergeben: `001-workflow-v3`, `002-remove-execution-lease`,
`003-keep-cas`, `004-remove-task-contract`, `006-single-completion-pipeline`
(hinzugefügt in Commit `9a4fed9`, 2026-07-28). Sie beschrieben die damalige,
komplexere Plan-Mode-Architektur (Execution-Leases, CAS, Task-Contract, eigene
Completion-Pipeline) und wurden bei deren Vereinfachung in Commit `7e9979c`
(2026-08-02, "simplify modes and align subagents") ersatzlos gelöscht — die
heutige Plan-Mode kennt laut `README.md` "keine Metadaten, Step-IDs, Sidecars,
Completion, Recovery, Migration oder Planpflicht" mehr. Kein Datenverlust: Der
volle historische Inhalt bleibt über Git abrufbar, z. B.
`git show 9a4fed9:docs/decisions/001-workflow-v3.md`.
