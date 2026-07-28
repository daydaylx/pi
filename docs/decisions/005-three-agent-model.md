# 005 — Drei lokale Rollen: Planner, Worker, Reviewer

## Kontext

Das Setup führte zeitweise zehn lokale Subagenten (unter anderem `architect`,
`oracle`, `scout`, `test-runner`, `security-auditor`, `ui-reviewer`,
`docs-auditor`). Die Zuständigkeiten überlappten, und die Delegationsregeln
mussten Unterschiede beschreiben, die fachlich keine waren.

## Entscheidung

Es bleiben genau drei Rollen unter `agents/`: `planner`, `worker`, `reviewer`.
Paket-Builtins sind über `subagents.disableBuiltins` deaktiviert.

## Begründung

Die drei Rollen entsprechen den drei Phasen, die der Workflow tatsächlich kennt.
Jede weitere Rolle war eine Variante einer davon und verlangte eine Regel, wann
sie statt der Grundrolle zu wählen ist — Aufwand ohne Ergebnisunterschied.

## Konsequenzen

- Der Completion-Reviewer läuft über die versionierte In-Process-RPC von
  `pi-subagents` und bleibt vom Worker unabhängig.
- Ein Web-Researcher ist mangels Web-Toolchain nicht installiert.
- Spezialprüfungen (Sicherheit, UI, Doku) sind Skills, keine eigenen Agenten.
