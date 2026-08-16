# Context Ledger — agent

## Bestätigte Nutzerentscheidungen

- `pi-harness-hardening-v2` wird schrittweise umgesetzt. Seine vier
  Kernphasen sind Workspace-Snapshot, Verifikationsstatus, Trace-Diagnostik
  und Tool-/Kontextqualität.
- Independent Verifier, Modellrouting, Compaction und Planmodus-Anomalien
  bleiben datengetriebene Experimente und sind keine Standardautomatik.

## Architekturentscheidungen

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
  wechseln in `contextual` ihren Glyph, `ANTWORTET` und `WARTET` bleiben
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
- Das Compaction-Budget ist gemessen, nicht geschätzt (`docs/decisions/010`):
  Reserve 49152, Recent 20000, Auslösung bei 81,9 % des Fensters. Entscheidend
  ist, dass `reserveTokens` **zwei** Dinge zugleich steuert — die Schwelle und
  das Summary-Budget (`0,8 × reserve`). Die frühere Reserve ließ nur 32768
  Tokens Luft, während 25,3 % realer Turns um mehr als das wuchsen; ein
  Überlauf ist nur einmal wiederherstellbar, danach ist der Turn verloren.
  Werte sind im Runtime-Test gegen einen stillen Rückbau festgenagelt.

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
- Für P2 liegen noch keine konkret priorisierten Befunde zu Restkomplexität,
  Dokumentation oder Knip-Regeln vor; diese müssen vor einer Bereinigung
  gezielt erhoben werden. Belegt ist bislang nur `tests/suites/runtime.mjs`
  (5383 Zeilen, Stand dieses Commits); die Aufteilung kann die vorhandene
  `SECTION_SUITES`-Registry als Schnittkante nutzen.
- (Historisch, behoben.) Bis zum Repin auf `node 22.23.2` / `npm 10.9.8` in
  `.nvmrc` und `engines` (Commit `432517c`) lief der lokale Host bereits auf
  dieser Version, während `.nvmrc`/`engines` noch `22.22.2` / `10.9.7`
  forderten — ein reiner Patch-Level-Unterschied ohne Versionsverwaltung, den
  alle Suiten und die CI tolerierten. Der Repin hat diesen Host-vs-Pin-Abstand
  geschlossen, aber `.github/workflows/verify.yml` und `lsp-smoke.yml` blieben
  unverändert auf `node-version: 22.22.2` hart kodiert — die Abweichung
  wanderte unbemerkt von „Host vs. Pin" zu „CI vs. Pin" und produzierte bei
  jedem CI-Lauf eine ignorierte `EBADENGINE`-Warnung. Behoben: beide Workflows
  lesen die Node-Version jetzt über `node-version-file: ".nvmrc"`, und
  `npm ci` läuft mit `--engine-strict`, sodass eine künftige Abweichung den
  Build hart fehlschlagen lässt statt nur zu warnen.
- Der Live-Smoke ist aus einer nicht-interaktiven Umgebung nicht durchführbar.
  Aurora-Sichtbarkeit, Shift+Tab, der reale Plan→Work-Handoff und ein echter
  Subagent-Aufruf bleiben ohne authentifizierte TTY-Sitzung unbelegt
  (`docs/manual-smoke-checklist.md`).

## Offene Risiken

- Git-Sonderfälle wie Umbenennungen, gelöschte und indexierte Dateien müssen
  bei allen unterstützten Git-Versionen gleich behandelt werden.
- Zusätzliche Metriken oder Statushinweise können Schemakompatibilität,
  Tokenverbrauch und Warnungsdichte beeinträchtigen.

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
