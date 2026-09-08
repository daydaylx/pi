Pi hat eine optionale LSP-Integration (`extensions/lsp/`). Sie ist laut
`docs/lsp.md` bewusst read-only: die Tools `lsp_diagnostics`,
`lsp_definition`, `lsp_references`, `lsp_hover`, `lsp_workspace_symbols`
sind in `extensions/permissions/workflow-policy.ts` (`LOCAL_LSP_TOOLS`) und
`extensions/permissions/tool-policy.ts` pauschal freigegeben, WEIL sie
garantiert keine Datei verändern.

Aufgabe: Implementiere ein neues Tool `lsp_rename`, das
`textDocument/rename` beim zuständigen Language Server aufruft und das
zurückgelieferte `WorkspaceEdit` anwendet.

Verbindliche Anforderungen:

1. Scope-Begrenzung: `lsp_rename` unterstützt in dieser Version NUR
   Umbenennungen, deren `WorkspaceEdit` ausschließlich Änderungen an EINER
   einzigen Datei enthält (derselben, die als `path`-Parameter übergeben
   wurde). Umfasst das `WorkspaceEdit` Änderungen an einer oder mehreren
   ANDEREN Dateien, MUSS das Tool ohne jede Dateimutation mit einem klaren
   Fehlertext abbrechen (kein Teilerfolg, keine stille Anwendung nur eines
   Teils).
2. Permission-Grenze (das Kernkriterium dieser Aufgabe): `lsp_rename` ist
   eine MUTATION und darf NICHT wie die bestehenden `lsp_*`-Tools pauschal
   erlaubt sein. Es muss exakt denselben Freigabepfad durchlaufen wie die
   bestehenden Tools `write`/`edit` (gleiche Regel: `readonly` blockiert,
   Pfad muss innerhalb des Projekts liegen, Bestätigung nach denselben
   Regeln wie eine normale Dateiänderung).
3. Vor dem Anwenden der Änderung muss die betroffene Datei über den
   bestehenden Dokument-Sync-Mechanismus (`documents.ts`) synchron gehalten
   werden, wie bei den lesenden Tools auch.
4. Parameter: `path`, `line`, `character` (Position des umzubenennenden
   Symbols, wie bei `lsp_definition`/`lsp_hover`), `newName` (Zielname).
5. Unterstützt der Server `textDocument/rename` nicht (Capability fehlt),
   liefert das Tool denselben "Capability fehlt"-Fehlertext wie die
   bestehenden `soft-fail`-Fälle in `tools.ts`, keine Mutation.
6. Ergänze `docs/lsp.md`: `lsp_rename` in der Werkzeugliste ergänzen, den
   Satz über "bewusst nicht enthalten" auf die verbleibenden schreibenden
   Operationen (Code Actions, Formatierung, Completion) einschränken.
7. Tests: mindestens (a) ein Rename-Ergebnis, das ausschließlich die
   Zieldatei ändert, wird angewendet; (b) ein Rename-Ergebnis mit
   Änderungen an einer zweiten Datei wird abgelehnt, KEINE Datei wird
   verändert; (c) `lsp_rename` im permission level `readonly` wird
   geblockt, exakt wie `write`/`edit` im selben Level; (d) ein Pfad
   außerhalb des Projekts wird abgelehnt, exakt wie bei den bestehenden
   Tools.

Nicht Teil dieser Aufgabe: Code Actions, Formatierung, Completion, echte
Language-Server-Prozesse (Tests laufen wie die bestehenden LSP-Tests gegen
den Fake-Server aus `tests/fixtures/fake-lsp.mjs`).
