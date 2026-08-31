`changedFiles` und `totalChanges` in
`benchmark-fixture/diff-viewer/change-tracker.ts` iterieren beide manuell
über `this.changes.values()`/`.entries()`. Vereinheitliche das, ohne das
öffentliche Verhalten (Rückgabewerte, Sortierung, Typen) zu verändern.

Test: `node benchmark-fixture/run-fixture-test.mjs`

Erlaubter Änderungsumfang: ausschließlich
`benchmark-fixture/diff-viewer/change-tracker.ts`, keine Änderung der
exportierten Klassenschnittstelle (`ChangeTracker` behält identische
öffentliche Getter/Methoden: `changedFiles`, `totalChanges`, `recordChange`,
`getChangesForFile`, `reset`, `reconstructFromSession`, `initialized`).
Ändere keine anderen Dateien unter `benchmark-fixture/` (insbesondere nicht
`types.ts` oder `run-fixture-test.mjs`).
