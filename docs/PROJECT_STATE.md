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

## Letzte Verifikation

- Hauptrepo: `npm run verify` vollständig grün — Prettier, Typecheck, Knip,
  alle Suiten und die Coverage-Gates. `extensions/aurora-ui/index.ts` liegt bei
  38/38 Funktionen (100 %); die Schwelle wurde nicht gesenkt und keine Datei
  ausgeschlossen.
- Fork: `test:unit` 1151/1151, `test:integration` 492/492, `test:e2e` 1/1 grün.
  `npm run typecheck` bleibt dort vorbestehend rot (810 Fehler, davon 49 in
  `src/`); durch diese Arbeit kamen keine hinzu, fünf in
  `src/extension/index.ts` sind entfallen.
- Manuell geprüft: `18c4851fe19e6635e42b7d8911b8a91e1747f7f9` ist über die
  GitHub-API erreichbar, der alte Pin antwortet mit `422 No commit found`.

## Nächste Schritte

- Eine echte Greenfield-Installation auf einer frischen Maschine
  (`npm run install:user` plus Paketauflösung des neuen Pins) gegen den
  gepinnten Fork durchführen; im Repo ist bislang nur der
  Installer-Integrationstest abgedeckt.
- Restkomplexität und Knip-Regeln im P2-Cleanup weiterführen.
- Nur belegte Restbefunde dokumentieren.
