# 004 — Kein Task Contract, kein Decision Brief

## Kontext

Ziel, Scope und Abschlusskriterien einer Aufgabe standen früher in
`.agent/task-contract.json`, Nutzerentscheidungen zusätzlich in einem separaten
`decision-brief.md` mit eigenem Hash und eigenem Lebenszyklus. Damit gab es bis
zu drei Orte für dieselbe fachliche Aussage.

## Entscheidung

Beide Artefakte sind entfernt.

- Für Planaufgaben stehen Ziel, Nicht-Ziele, bewertete Optionen, gewählte
  Lösung, Begründung, Risiken, technischer Scope und Abschlusskriterien im
  PlanSnapshot selbst.
- Für Kleinstaufgaben ohne Plan gilt `.agent/direct-task.json` (`DirectTask`):
  `taskId`, `goal`, `technicalScope`, `verification`, `acceptanceCriteria`.

Die Scope-Prüfung liest direkt aus PlanSnapshot beziehungsweise DirectTask.

## Begründung

Der Task Contract wurde von keinem Codepfad je geschrieben; der auf ihn
gestützte Scope-Drift-Zweig des alten Gates war unerreichbar. Der Decision Brief
verdoppelte, was der Architekturplan ohnehin als Pflichtabschnitte führt.

## Konsequenzen

- Die interaktive Entscheidungsfindung im Planungsmodus bleibt unverändert —
  entfernt wurde das separate Artefakt, nicht der Vorgang.
- Ein Architekturplan verlangt weiterhin zwei bis vier tatsächlich
  unterschiedliche Optionen; ein Schnellplan erfindet keine Alternativen.
- Der Reviewer prüft den PlanSnapshot, nicht ein Nebendokument.
