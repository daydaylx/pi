# Context Ledger — agent

## Bestätigte Nutzerentscheidungen

- `pi-harness-hardening-v2` wird schrittweise umgesetzt. Seine vier
  Kernphasen sind Workspace-Snapshot, Verifikationsstatus, Trace-Diagnostik
  und Tool-/Kontextqualität.
- Independent Verifier, Modellrouting, Compaction und Planmodus-Anomalien
  bleiben datengetriebene Experimente und sind keine Standardautomatik.

## Architekturentscheidungen

- Aurora-Dashboard-Präsentation hat einen Besitzer: `ui.dashboard`
  (`auto|compact|expanded|hidden`, Default `auto`) im zentralen Setup-Schema;
  Umschaltung nur über `/dashboard` (Super+Q-Command-Center), kein neuer
  Shortcut (`docs/decisions/019`). Phase und Verifikationsurteil werden getrennt
  hergeleitet, teilen aber genau eine Staleness-Definition; `done` erfordert
  idle plus aktuellen `READY`-Check, und nur ein real laufendes Verification-Tool
  zeigt `Prüfen`. Routine-`verified` gehört dem sichtbaren Dashboard, nicht dem
  Footer; failed/stale bleiben kritische Footer-Risiken. Der Fünfstufen-
  Fortschrittsbalken existiert nur noch im Expanded-Modus. Quiet-Tools melden
  sich neutral ohne Warnton. Renderentscheidungen (Ticker, Caching) folgen
  Messwerten, nicht Annahmen — ein volles Widget-Frame kostet ~1 ms.

- Aurora Night bleibt die aktive UI; die normalen Permission-Level und
  Trust-Grenzen bleiben erhalten.
- Der Planmodus besitzt nur `work`, `simple_plan` und `detailed_plan`.
  `.agent/plans/current-plan.md` ist unverbindlicher Markdown-Kontext.
- P4 und der allgemeine Benchmark-Collector verwenden einen gemeinsamen,
  versionierten Workspace-Snapshot. Er erfasst `HEAD`, staged, unstaged und
  untracked Änderungen, Renames und Deletes und speichert keine Patches,
  Dateiinhalte oder absoluten Pfade.
- `project_check` ist der einzige Weg zur vollständigen Projektverifikation
  und der einzige, der Footer und Ledger fortschreibt. Das `verify`-Tool
  bietet nur noch die schnellen Teilprüfungen `typecheck` und `test` an;
  vorher boten beide denselben Befehl an, wovon aber nur `project_check` den
  Status aktualisierte. Keines von beiden ist eine Abschlussbedingung.
- CI-`verify` benötigt vollständige Git-Historie (`fetch-depth: 0`), weil
  `benchmarks/harness/p4-manifest.json` einen Referenz-Commit gegen die
  lokale Historie prüft; ein flacher Checkout ließ CI unabhängig von
  Codequalität rot laufen. `npm run test:runtime` ist bewusst nicht Teil der
  `verify`-Kette, da es eine entwicklerspezifisch gepatchte Runtime prüft.
- Der Verifikationsstatus ist sitzungsgebunden, an den gemeinsamen
  Workspace-Snapshot gebunden und rein technisch. Er erscheint dedupliziert
  bei `agent_settled`, ist abschaltbar und nutzt weder `agent_end` als
  Erledigung noch Heuristiken als `blocked`.
- Aurora besitzt Fußzeile und transientes Activity-Widget
  (`docs/decisions/007`, `docs/decisions/009`). Die Fußzeile ist eine einzige
  Zeile und die einzige permanente Statusfläche. Das Eingabefeld ist Pis
  eigener Editor: Aurora installiert keine Editor-Komponente mehr
  (`docs/decisions/013`), sodass `editorPaddingX` und
  `autocompleteMaxVisible` aus `settings.json` wieder wirken. Subagenten
  stehen im Activity-Widget, nicht in der Fußzeile.
- Aurora animiert nur echte laufende Arbeit: `DENKT NACH` und `ARBEITET`
  wechseln in `contextual` ihren Glyph, `ANTWORTET` und `WARTET AUF MODELL` bleiben
  statisch und werden nur für die Laufzeitanzeige neu gezeichnet. Statuslabels,
  Ton-Zuordnung und Overflow-Zusammenfassung liegen ausschließlich in
  `extensions/aurora-ui/tool-renderers.ts`.
- Größenklassen für Menüs und Fußzeile stehen gemeinsam in
  `extensions/shared/layout.ts` (52×14 / 90×28 / 120×30) und werden nirgends
  als Literal wiederholt.
- Es gibt genau drei aktive Subagentenrollen — `investigator`, `debugger`,
  `verifier` (`docs/decisions/011`). Die `verifier`-Delegation ist
  risikobasiert: verpflichtend nur bei Sicherheits-, Permission-/Plan-Mode-,
  Workflow-/Activity-State-, API-/Schema-, Installations-/Upgrade- oder
  Verifikationslogik, hohem Blast-Radius oder auf ausdrückliche
  Nutzeranforderung. Mehrere betroffene Dateien allein lösen keine Pflicht aus.
- Die Subagent-Tool-Surface wird durch `toolSchemaMode: "harness"` reduziert,
  nicht mehr als Nebenwirkung von `toolDescriptionMode: "custom"`
  (`docs/decisions/014`). `action` ist ein geschlossenes Enum aus `list`,
  `status`, `stop`, `interrupt`; zusätzliche Eigenschaften werden abgelehnt.
  Es gibt keine Subagent-Parallelitätskonfiguration mehr — sie hatte keinen
  Laufzeitverbraucher.
- Shift+Tab ist die einzige normale Workflow-Steuerung: Die Auswahl Work,
  Schnellplan oder Architekturplan wartet danach auf die nächste echte
  Nutzereingabe, startet keinen Turn und verändert keine vorhandene
  Plandatei. `/plan`, `/work`, `/go` und ihr `Super+P`-Shortcut sind keine
  öffentlichen Workflow-Wege mehr. Ein Plan aus einem tatsächlich beendeten
  Planning-Turn kann beim anschließenden Work-Turn einmalig als flüchtiger
  Kontext dienen; alte Dateien und fortgesetzte Sitzungen werden nie
  automatisch eingebunden. Dieselbe Änderung führte die Delegationsvorlage
  (Original User Request / Constraints / Delegated Question) in `AGENTS.md`
  ein.
- Plan Mode erlaubt neben der Plandatei nur nachweislich lesende Git- und
  Ripgrep-Aufrufe; Projekt-Skripte, `project_check` und `subagent` sind
  gesperrt. `yolo` bleibt die ausdrückliche Ausnahme
  (`docs/decisions/012`).
- Ausgelieferte Erweiterungen müssen ohne Arbeitsbaum-Kontext laden: Ein
  lexerbasierter Literal-Importcheck (`scripts/check-relative-imports.mjs`)
  und ein Versioned-Tree-Check (`scripts/check-versioned-tree.mjs`,
  `git archive HEAD` + Importcheck + Laden der aktiven Extensions) sichern
  ab, dass kein `index.ts` eine unversionierte Datei importiert. Der Check
  gilt nur für HEAD, nicht für den Arbeitsbaum, und ersetzt keine CI-Pipeline.
- Tool-Receipts im Collapsed-Zustand sind informative Einzeilen
  (`collapse-result.ts`): Fehler, Partial Output, Truncation und leere
  Ergebnisse bleiben immer sichtbar beim nativen Renderer.
- Tokenmetriken trennen Cache-Anteile: `cacheRead`/`cacheWrite` werden
  separat summiert; `providerReportedTotal` ist das rohe `usage.totalTokens`
  und darf Cache-Buchhaltung enthalten — es ist keine Formel aus
  input+output+reasoning (`benchmarks/SCORING.md`,
  `harness/schema/run-result.schema.json`).
- `project_check` benennt seinen Prüfstand explizit: Das Ergebnis gilt für
  den Workspace-Snapshot (Fingerprint), niemals automatisch für den
  versionierten HEAD.
- Der Nutzer-Installer liefert `APPEND_SYSTEM.md` und `prompts/` mit; die
  Allowlist in `scripts/install-user.mjs` ist die einzige Quelle dafür.
- `APPEND_SYSTEM.md` beschreibt phasenbasierte Narration, keine
  Tool-für-Tool-Kommentierung.
- Das Compaction-Budget ist gemessen (`docs/decisions/010`): Reserve 49152,
  Recent 20000, Auslösung bei 81,9 % des Fensters. `reserveTokens` steuert
  Schwelle und Summary-Budget (`0,8 × reserve`) zugleich; ein Überlauf ist nur
  einmal wiederherstellbar. Die Werte sind im Runtime-Test gegen stillen
  Rückbau festgenagelt (Upstream-Default: 20.000 Tokens).

## Nicht-Ziele

- Keine neue Planner-Worker-Reviewer-Kette, keine Abschluss-Pipeline und
  keine automatische Checkausführung.
- Keine freie Shell in Projektprüfprofilen und keine automatische Installation.
- Keine Speicherung von Secrets, vollständigen Toolausgaben, privaten
  Evaluatordetails oder Modellgedanken in Benchmark- oder Runtimezuständen.

## Bekannte Einschränkungen

- Kontrollierte Baseline- und Holdout-Läufe für die neue Snapshotlogik stehen
  noch aus.
- Vorbestehende Änderungen im Arbeitsbaum außerhalb des Hardening-Scopes
  müssen erhalten bleiben.
- Der Fork `daydaylx/pi-subagents` ist im Typecheck vorbestehend rot
  (Testdateien und Altbestände in `src/`). Er ist deshalb nicht Teil einer
  Pflichtprüfung des Hauptrepos; seine Unit-, Integrations- und E2E-Suiten
  sind grün.
- Für P2 fehlen priorisierte Befunde zu Restkomplexität, Dokumentation und
  Knip-Regeln; belegt ist bislang nur `tests/suites/runtime.mjs` (5383
  Zeilen) — die Aufteilung kann die `SECTION_SUITES`-Registry als
  Schnittkante nutzen.
- (Historisch, behoben.) Der Node-Pin-Drift wanderte unbemerkt von
  „Host vs. Pin" zu „CI vs. Pin" (ignorierte `EBADENGINE`-Warnungen). Seit
  Commit `432517c` lesen beide Workflows die Version aus `.nvmrc`, und
  `npm ci` läuft mit `--engine-strict` — eine künftige Abweichung lässt den
  Build hart fehlschlagen.
- Der Live-Smoke ist aus einer nicht-interaktiven Umgebung nicht durchführbar.
  Aurora-Sichtbarkeit, Shift+Tab, der reale Plan→Work-Handoff und ein echter
  Subagent-Aufruf bleiben ohne authentifizierte TTY-Sitzung unbelegt
  (`docs/manual-smoke-checklist.md`).

## Offene Risiken

- Git-Sonderfälle wie Umbenennungen, gelöschte und indexierte Dateien müssen
  bei allen unterstützten Git-Versionen gleich behandelt werden.
- Zusätzliche Metriken oder Statushinweise können Schemakompatibilität,
  Tokenverbrauch und Warnungsdichte beeinträchtigen.
- `extensions/aurora-ui/dev-diagnostics.ts` ist unversioniert, wird aber von
  `index.ts` importiert: Bis zum Commit bleibt `check:versioned-tree` rot
  und ein Ausliefern von HEAD reproduziert den CI-Verify-Failure #156.

## Offene Fragen

_Keine offenen Fragen._

## Wichtige Projektregeln

- Schutzregeln zu Nutzeränderungen, Auftragsscope, Commits/Pushes: siehe
  `AGENTS.md`.
- Nach relevanten Änderungen läuft `npm --prefix npm run verify`. Nur ein
  `project_check`-Aufruf des Pflichtprofils `verify` aktualisiert den
  Footer/Ledger — ein reiner `bash`-Lauf desselben Befehls oder ein Lauf aus
  `verifier` heraus tut das nicht (siehe `docs/verify-profiles.md`).
- `npm run test:runtime` ist bewusst kein Teil von `verify`/CI: es prüft eine
  lokal gepatchte Runtime unter einem entwicklerspezifischen Pfad
  (`PI_RUNTIME_ROOT`), den kein CI-Runner besitzt (siehe
  `docs/RUNTIME_PATCHES.md`).

## Aktuelle Prioritäten

- Commit von `extensions/aurora-ui/dev-diagnostics.ts` (und der übrigen
  Audit-Änderungen) — erst danach sind Versioned-Tree-Check und CI grün.
  Commits nur auf ausdrücklichen Auftrag.
- Der Live-Smoke ist der einzige offene P0-Punkt (`#137`). Ohne ihn bleibt der
  Stand `BEDINGT STABIL`, unabhängig davon, wie grün Verifikation und CI sind.
- P2 erst danach: Konkrete Befunde zu Restkomplexität, Dokumentation und
  Knip-Regeln erheben und daraus gezielte Folgearbeiten ableiten.
- Der Fork-Pin bleibt ein vollständiger, bei GitHub erreichbarer SHA. Vor jeder
  Pin-Änderung die Erreichbarkeit manuell prüfen; die lokale Test-Suite bleibt
  bewusst offline.
- Erreichbarkeit allein genügt nicht: Ein neuer Pin muss den alten auch
  enthalten. `main` des Forks ist nicht automatisch der neueste Stand — die
  Arbeit liegt teils auf Themenbranches. Vor jeder Pin-Änderung
  `compare/<alt>...<neu>` prüfen und nur setzen, wenn `behind_by` 0 ist.
  Ein Rückschritt hat schon einmal unbemerkt einen Sicherheitsfix aus der
  Auslieferung entfernt.

## Verworfene Optionen

- Ein großer allgemeiner Runtime-State, automatische `blocked`-Klassifikation
  und standardmäßig aktive Recovery-Nudges sind verworfen, bis Messdaten
  ihren Nutzen belegen.
- Eine zweite vollständige Verify-Pipeline (z. B. ein eigener CI-Workflow
  für den Arbeitsbaum) ist verworfen; stattdessen gibt es den schlanken
  Versioned-Tree-Check plus den dokumentierten `git archive HEAD`-Weg.
