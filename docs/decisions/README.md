# Decisions

Ein Architecture-Decision-Log. Jede Datei ist für ihr Thema kanonisch; neuere
Entscheidungen verweisen auf ältere, wenn sie sie ersetzen oder ändern.

## Aktive Entscheidungen

- [007](007-aurora-single-ui-owner.md) — Aurora ist einziger aktiver UI-Besitzer
- [008](008-context-ledger-is-documentation.md) — Das Context Ledger ist Dokumentation, keine Laufzeitkomponente
- [009](009-aurora-owns-the-footer.md) — Aurora besitzt auch die Fußzeile
- [010](010-compaction-recent-context-budget.md) — Recent-Context-Budget nutzt den Upstream-Default von 20.000 Tokens
- [011](011-investigator-debugger-verifier.md) — Investigator, Debugger, Verifier ersetzen Planner, Worker, Reviewer (Investigator/Debugger durch 031 abgelöst)
- [013](013-aurora-keeps-the-native-editor.md) — Aurora behält Pis nativen Editor (ersetzt den Editor-Teil von 009)
- [014](014-reduced-subagent-tool-surface.md) — Die reduzierte Subagent-Tool-Surface ist ein eigener Schalter
- [015](015-verifier-delegation-guard.md) — Verifier-Delegationen werden technisch erzwungen, nicht appelliert
- [016](016-plan-mode-yolo-lock-and-recovery-gate.md) — YOLO-Sperre im Planmodus und Recovery-Gate vor Schreibzugriffen (Planmodus-Teil durch 035 ersetzt, Recovery-Gate gültig)
- [017](017-verifier-acceptance-none.md) — Verifier-Akzeptanz ohne eigenes Urteil
- [018](018-subagent-delegation-always-allowed.md) — Subagent-Delegationen immer erlaubt
- [019](019-dashboard-modes-and-phase-precedence.md) — Dashboard-Modi mit einer Staleness-Wahrheit für Phase und Verifikation
- [021](021-verifier-dedup-gate.md) — Verifier-Delegationen werden auf unverändertem Fingerprint dedupliziert
- [022](022-project-write-interpreter-boundary.md) — Project-write fragt bei opakem Code gezielt nach
- [023](023-single-dashboard-surface.md) — Eine Dashboard-Fläche statt fixem Panel plus Kachel-Grid (bekräftigt 019)
- [024](024-remove-verification-tile-and-phase-chain.md) — PRÜFUNGEN-Kachel und Phasenkette aus dem Dashboard entfernt
- [025](025-merge-task-and-activity-tile.md) — Aufgabe- und Aktivität-Kachel zu einer Kachel verschmolzen, Kachel-Titel in normaler Schreibweise
- [026](026-more-animation-subagents-and-badge-flash.md) — Animierte Subagenten-Zeilen und Badge-Flash bei Statuswechsel
- [028](028-aurora-forge-visual-state-and-motion.md) — Semantische Visual States und gemeinsame Motion für Aurora Forge
- [029](029-yolo-three-stufen.md) — YOLO in drei Stufen: Projekt, mit Rückfrage, Vollzugriff
- [030](030-rabbitmode-read-only-status-contract.md) — RabbitMode liest Permission/Workflow-State über einen dokumentierten Contract, kein Package-Export
- [031](031-temporary-task-agents.md) — Temporäre Task-Agenten (stateless, Runtime-Limits, Evidenz) statt fester Subagenten-Rollen
- [032](032-verifier-need-gate.md) — Verifier Need-Gate: technisch erzwungene required/justified/not_needed-Entscheidung für optionale Verifier-Läufe
- [033](033-task-tiers.md) — Task-Klassen FAST/NORMAL/DEEP (Klassifikation durch 039 abgelöst; Duplicate-Read-Guard und Telemetrie gültig)
- [034](034-system-control.md) — Typed System-Control-Werkzeuge ohne Root-Daemon
- [035](035-remove-plan-mode.md) — Planmodus und Workflow-Zustand entfernt, Shift+Tab freigegeben
- [037](037-skill-select-shift-tab.md) — Skill-Auswahl auf Shift+Tab: Vormerkung über die native `/skill:`-Expansion
- [039](039-task-tier-vereinfacht.md) — Task-Tier nur noch Duplicate-Read-Guard und Telemetrie; keine Klassen, keine Thinking-Automatik
- [041](041-recovery-als-unterbrechungshinweis.md) — Recovery-Gate entfällt; ein Unterbrechungshinweis aus dem nativen Session-Zweig bleibt; sed-/Subshell-/Wrapper-Befunde behoben; Risiken des offenen Systemprofils bewertet
- [042](042-headless-blockaden-weich.md) — Blockaden ohne UI sind für zwei Aufrufe weich (Hinweis auf lokale Alternative), die dritte beendet den Lauf; `ask_user` ohne UI folgt demselben Budget
- [043](043-pis-ohne-pi-seitige-blockaden.md) — `pis` blockiert keine Pi-eigenen Permission- und Tool-Call-Aufrufe
- [040](040-harness-vereinfachung-2026-10-16.md) — Harness-Vereinfachung auf Messbasis: Ask-User, Shell-Fehlalarme, automatische Recovery-Prüfung, native Systemskills, Patches 11 auf 8, Subagent-V2 nicht gebaut

## Historische, ersetzte Entscheidungen

- [036](036-pis-open-policy.md) — `pis` fragt vor riskanten Aktionen (abgelöst durch 042)
- [005](005-three-agent-model.md) — Drei lokale Rollen: Planner, Worker,
  Reviewer (vollständig ersetzt durch 011)
- [012](012-plan-mode-mutation-guard.md) — Plan Mode bekommt einen technischen
  Mutationsschutz (ersetzt durch 035)
- [020](020-explicit-plan-approval.md) — Ausdrückliche Planfreigabe,
  sitzungsbezogene Ablage, turnfester Modus (ersetzt durch 035)

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
