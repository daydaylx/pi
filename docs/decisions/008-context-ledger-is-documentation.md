# 008 — Das Context Ledger ist Dokumentation, keine Laufzeitkomponente

## Kontext

`extensions/shared/context-ledger.ts` (603 Zeilen) konsolidierte das Ledger
automatisch: bei Plan→Work, bei Completion, an einer Token-Schwelle vor der
Compaction und beim Sessionende. Die Trigger wurden bereits vorher entfernt;
danach war das Modul von keiner der aktiven Extensions mehr erreichbar, wurde
aber weiterhin von 35 Assertions getestet.

## Entscheidung

Modul und JSON-Schema sind gelöscht. `docs/CONTEXT_LEDGER.md` und
`docs/PROJECT_STATE.md` bleiben als gewöhnliche Markdown-Dokumente, gepflegt
ausschließlich über den Skill `context-checkpoint`.

## Begründung

Ein Ledger, das der Workflow automatisch schreibt, ist eine zweite
Aufgabenquelle neben dem PlanSnapshot. Ein Ledger, das niemand schreibt, ist
toter Code. Als bewusst gepflegte Langzeitdokumentation ist es nützlich — dafür
braucht es keinen Laufzeitcode.

## Konsequenzen

- Die Laufzeit besitzt keine Abhängigkeit zum Ledger; kein Hook, kein
  Schreibvorgang, keine Prioritätenübernahme, keine Completion-Blockade.
- `docs/PROJECT_STATE.md` steuert den Coding-Workflow nicht und wird von keinem
  Runtime-Modul importiert.
- Der Benchmark-Task `11-context-ledger-survival` ist entfernt: seine Messfrage
  betraf eine Funktion, die es im Produkt nicht mehr gibt.
- Die Testzahl sinkt entsprechend. Historische Tests werden nicht gehalten, um
  eine Zahl zu stützen.
