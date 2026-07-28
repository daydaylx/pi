# 001 — Workflow v3 als einziger Workflow

## Kontext

Die Vorgänger v1 und v2 hielten Planinhalt, Fortschritt, Phase und Lebenszyklus
in wechselnden Kombinationen aus Markdown und JSON. Dieselbe fachliche Information
existierte an mehreren Stellen und konnte auseinanderlaufen.

## Entscheidung

Es gibt genau zwei Artefakte und genau ein Statusmodell.

- `.agent/plans/current-plan.md` ist die einzige fachliche Quelle (PlanSnapshot).
- `.agent/plans/current-plan.state.json` enthält ausschließlich Laufzeitstatus.
- `WorkflowStatus` ist in `extensions/shared/workflow-status.ts` deklariert:
  `idle`, `planning`, `working`, `reviewing`, `paused`, `blocked`, `done`.
  `plan-mode/store/types.ts` re-exportiert ihn; eine zweite Deklaration gibt es
  nirgends.

Stabile `PI-STEP-ID`s verbinden beide Artefakte. Während `working` ist der
Markdown-Plan unveränderlich.

## Begründung

Ein Statuswert, der an zwei Stellen definiert ist, driftet. Die Trennung von
fachlicher Quelle und Laufzeitstatus macht jederzeit beantwortbar, welches
Artefakt bei einem Widerspruch gewinnt.

## Konsequenzen

- Alte Werte (`draft`, `deciding`, `reviewed`, `executing`, `ready`) erscheinen
  ausschließlich in `legacyStatus()` der v1/v2-Migration.
- Präsentationsschichten dürfen andere Labels zeigen, aber keine eigenen
  Statuswerte führen. `AuroraWorkflowPhase` ist `WorkflowStatus | "archived"`.
- Wer einen Status hinzufügen will, ändert genau eine Datei.
