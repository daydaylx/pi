# Project State

## Aktuelle Arbeit

Stabilisierung und Vereinfachung der letzten Pi-Änderungen (August 2026).
Umgesetzte Phasen:

- **Fork-Pin repariert**: Der gepinnte SHA
  `2004b727d2362363b47c95a93ff40cfc4204ad19` existierte nur lokal und war bei
  GitHub nicht erreichbar (`422 No commit found`); eine saubere Neuinstallation
  scheiterte daran. Die Arbeit wurde vom letzten erreichbaren Stand
  (`170a2808`, `agent/simplify-and-stabilize`) fortgesetzt und als
  `18c4851fe19e6635e42b7d8911b8a91e1747f7f9` gepusht. `settings.json` pinnt
  diesen erreichbaren, vollständigen SHA. Ein späterer Repin auf den damaligen
  `main`-HEAD (`2934a93f`) hatte den Pin um drei Commits zurückgesetzt und
  dabei den Sicherheitsfix `170a2808` sowie die Tool-Surface-Trennung wieder
  aus der Auslieferung entfernt; das ist zurückgenommen.
- **Reduzierte Tool-Surface entkoppelt**: Der Fork kennt jetzt
  `toolSchemaMode: "full" | "harness"` getrennt von `toolDescriptionMode`.
  `action` ist ein geschlossenes Enum (`list`, `status`, `stop`, `interrupt`),
  und das Schema setzt `additionalProperties: false` — Chain, Parallel, CRUD,
  Scheduling, Worktrees, Sharing, Watchdog, `resume`, `steer` und
  `append-step` scheitern jetzt tatsächlich an der Argumentvalidierung statt
  nur in der Dokumentation (`docs/decisions/014`).
- **Tote Parallelitätskonfiguration entfernt**: `subagents.concurrency` ist aus
  `setup.json`, `schemas/setup.schema.json`, `extensions/setup-core/config.ts`
  (Default, Typ, Parser, Validierung, Projekt-Layer), der Setup-Doctor-Ausgabe,
  den Tests und der Dokumentation verschwunden. `/setup-doctor` meldet
  stattdessen beide Tool-Surface-Schalter.
- **Verifier-Regeln risikobasiert**: Mehrere betroffene Dateien lösen keine
  Pflichtdelegation mehr aus. Verpflichtend bleibt der `verifier` bei
  Sicherheits-, Permission-/Plan-Mode-, Workflow-/Activity-State-, API-/Schema-,
  Installations-/Upgrade- und Verifikationslogik, hohem Blast-Radius oder auf
  ausdrückliche Nutzeranforderung. Dirty-State- und Content-Fingerprint-Regeln
  bleiben erhalten und stehen jetzt vollständig in `docs/subagents.md`.
- **Aurora vereinfacht**: `AuroraEditor` und `setEditorComponent()` sind
  entfernt; das Eingabefeld ist wieder Pis nativer Editor, wodurch
  `editorPaddingX` und `autocompleteMaxVisible` aus `settings.json` wieder
  wirken (`docs/decisions/013`). Im Modus `contextual` animieren nur noch
  `DENKT NACH` und `ARBEITET`; `ANTWORTET` und `WARTET` sind statisch, der
  langsame Ticker aktualisiert dort nur die Sekundenanzeige.
  `hiddenActivitySummary()` liegt jetzt in `tool-renderers.ts` und nutzt
  dieselben Statuslabels und dieselbe Zählung wie die übrigen
  Overflow-Zusammenfassungen.
- **AGENTS.md gekürzt**: Nur noch Regeln, die in fast jeder Sitzung gelten.
  Checkpoint-, Providerfehler- und Sitzungsablaufregeln stehen im Skill
  `context-checkpoint`, die Delegationsvorlage und die Fingerprint-Mechanik in
  `docs/subagents.md`. Keine neue Dokumentationsschicht.
- **Runtime-Auflösung zusammengeführt**: Skripte und Extensions lösen Paket und
  Version des Pi-Runtimes über das gemeinsame `shared/runtime-resolution.mjs`
  auf; Entwicklungs-`node_modules` und Benutzerpfade sind kein Fallback mehr.
- **Verifikationsdiagnostik vereinfacht**: Nur das optionale, nicht-kausale
  `changed_since_pass` bleibt bei einem vorher erfolgreichen Profil;
  Baseline-Maps, Pfadheuristiken und kausale Labels sind entfernt.

Abgeschlossene P0-Stabilisierung (`#137`–`#142`, Stand `05fbd01`). Jeder Verdacht
wurde vor einer Korrektur reproduziert; nicht reproduzierbare wurden als solche
geschlossen:

- **Fork-Pin-Rückschritt entfernt** (`#137`): Der Repin auf den damaligen
  `main`-HEAD war ein Rückschritt um drei Commits (`behind_by: 3`,
  `ahead_by: 0`) und entfernte den Sicherheitsfix `170a2808` aus der
  Auslieferung — am gepinnten Stand lief `acceptance.ts` weiterhin über
  `shell: true`. Die Pin-Regel im Ledger verlangt jetzt einen Lineage-Vergleich,
  nicht nur Erreichbarkeit.
- **Aurora-Lifecycle** (`#138`): Ein gemeinsamer `settle`-Handler auf `agent_end`
  **und** `agent_settled` ließ Aurora mitten im Turn auf Leerlauf fallen, weil
  Pi 0.84.1 `agent_end` nach jedem einzelnen Agentenlauf sendet. Nur noch
  `agent_settled` beendet die Anzeige. Vorher 7 fokussierte Fehlschläge.
- **Plan-Handoff** (`#139`): Gegen `04faefa` schlagen 28 Assertions fehl —
  persistierte Custom-Message, Plandatei beim _Start_ des Planning-Turns
  gelöscht, Teilplan nach Fehler/Abbruch. Zusätzlich entfällt der inhaltsleere
  `[PI WORKMODUS]`-Block bei jedem Work-Turn.
- **Verifikationsoberfläche** (`#140`): `setup.json` und `.pi/verify.json` boten
  denselben Befehl über zwei Tools an, aber nur `project_check` schreibt den
  Ledger. `clean` hieß „keine Änderungen" und las sich wie ein Prüfergebnis;
  jetzt `unchanged`.
- **Compaction-Budget** (`#141`): Gegen 12 reale Transkripte gemessen statt
  geschätzt (`docs/decisions/010`).
- **Permission-Policy** (`#142`): Vollständig charakterisiert, **keine**
  fehlerhafte Entscheidung gefunden, daher keine Policy geändert. Zwei in der
  README zugesicherte Eigenschaften waren ungetestet und sind es jetzt nicht
  mehr.
- **Test-Race behoben**: Ein Enkelprozess bekam 100 ms für seine PID-Datei, die
  dann bedingungslos gelesen wurde — unter Parallellast ENOENT und damit ein
  rotes `verify` ohne Codefehler.

## Letzte Verifikation

Stand `05fbd01`.

- Hauptrepo: `npm --prefix npm run verify` Exit 0 — Prettier, Typecheck, Knip,
  Coverage-Gates, Runtime-Patches und Dependency-Audit. 1314 Tests: runtime 811,
  workflow-mode 189, LSP 182, UI 77, diff 15, Patches 37, Audit 3.
  `git diff --check` Exit 0, Arbeitsbaum sauber.
- `extensions/aurora-ui/index.ts` liegt bei **37/37 Funktionen (100 %)**. Die
  Zählung sank von 38, weil der Aurora-Fix die gemeinsame `settle`-Closure
  entfernt hat; die Schwelle wurde nicht gesenkt und keine Datei ausgeschlossen.
- CI grün: Läufe `31744481889` und `31744759696` auf `main`.
- Fork: `test:unit` 1151/1151, `test:integration` 492/492, `test:e2e` 1/1 grün.
  `npm run typecheck` bleibt dort vorbestehend rot (810 Fehler, davon 49 in
  `src/`); durch diese Arbeit kamen keine hinzu.
- Manuell geprüft: `settings.json` pinnt
  `18c4851fe19e6635e42b7d8911b8a91e1747f7f9`. Der Fork-`main` wurde per
  Fast-Forward (`behind_by: 0`, ohne `force`) auf denselben SHA nachgezogen und
  trägt den Sicherheitsfix jetzt selbst — `src/runs/shared/acceptance.ts` steht
  auf `main` auf `shell: false`. Pin und Default-Branch sind damit deckungsgleich.
- Nicht ausgeführt: der Live-Smoke. Aurora im echten Terminal, Shift+Tab, der
  reale Plan→Work-Handoff, `project_check` gegen den echten Footer und ein
  echter Investigator-Aufruf sind unbelegt (`docs/manual-smoke-checklist.md`).

## Nächste Schritte

- Live-Smoke nach `docs/manual-smoke-checklist.md` in einer authentifizierten
  Sitzung durchführen. Erst danach darf `#137` geschlossen und das Urteil von
  `BEDINGT STABIL` auf `STABIL` gehoben werden.
- `tests/suites/runtime.mjs` (5276 Zeilen) entlang der vorhandenen
  `SECTION_SUITES`-Registry aufteilen — P2, erst nach dem Live-Smoke.
- Den lokalen, gitignorierten Klon `pi-subagents/` klären: Er trägt den Commit
  `2004b72`, den GitHub nicht kennt (`422`), plus rund 4.644 uncommittete
  Löschungen. Vermutlich überholt durch `18c4851f`, aber unbelegt — sichern,
  vergleichen oder verwerfen ist eine eigene Entscheidung.
