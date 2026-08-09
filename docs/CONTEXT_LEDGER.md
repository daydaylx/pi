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
- `verify` bleibt eine feste Setup-Prüfung; `project_check` führt nur
  explizit angeforderte, vertrauensgebundene Projektprofile aus. Beide sind
  keine Abschlussbedingungen.
- CI-`verify` benötigt vollständige Git-Historie (`fetch-depth: 0`), weil
  `benchmarks/harness/p4-manifest.json` einen Referenz-Commit gegen die
  lokale Historie prüft; ein flacher Checkout ließ CI unabhängig von
  Codequalität rot laufen. `npm run test:runtime` ist bewusst nicht Teil der
  `verify`-Kette, da es eine entwicklerspezifisch gepatchte Runtime prüft.
- Der Verifikationsstatus ist sitzungsgebunden, an den gemeinsamen
  Workspace-Snapshot gebunden und rein technisch. Er erscheint dedupliziert
  bei `agent_settled`, ist abschaltbar und nutzt weder `agent_end` als
  Erledigung noch Heuristiken als `blocked`.
- Aurora ist alleiniger Besitzer der TUI-Chrome inklusive Fußzeile
  (`docs/decisions/007`, `docs/decisions/009`). Die Fußzeile ist eine einzige
  Zeile und die einzige permanente Statusfläche; der Editorrahmen ist entfallen,
  Pis Editor bleibt unersetzt. Subagenten stehen im transienten
  Activity-Widget, nicht in der Fußzeile.
- Größenklassen für Menüs und Fußzeile stehen gemeinsam in
  `extensions/shared/layout.ts` (52×14 / 90×28 / 120×30) und werden nirgends
  als Literal wiederholt.
- Es gibt genau drei aktive Subagentenrollen — `investigator`, `debugger`,
  `verifier` (`docs/decisions/011`).
- Shift+Tab (`/workflow`) ist eine reine Modusauswahl und wartet danach auf
  die nächste Nutzereingabe; es startet weder einen Turn noch einen
  Plan-Handoff und verändert keine vorhandene Plandatei. Die expliziten
  Aktionen `/plan`, `/work`, `/go` rufen ausschließlich `selectWorkflow()`
  auf. Dieselbe Änderung führte die
  Delegationsvorlage (Original User Request / Constraints / Delegated
  Question) in `AGENTS.md` ein.
- Plan Mode besitzt zusätzlich zur Plandatei-Ausnahme einen technischen
  Mutationsschutz bei `project-write`/`confirm-all`, der `readonly`s bereits
  vorhandene Entscheidungsfunktionen wiederverwendet; `yolo` bleibt bewusst
  unangetastet (`docs/decisions/012`).

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

## Offene Risiken

- Git-Sonderfälle wie Umbenennungen, gelöschte und indexierte Dateien müssen
  bei allen unterstützten Git-Versionen gleich behandelt werden.
- Zusätzliche Metriken oder Statushinweise können Schemakompatibilität,
  Tokenverbrauch und Warnungsdichte beeinträchtigen.

## Offene Fragen

- Welche Ereignisse stellt die installierte Pi-Runtime für einen rein
  informativen Verifikationsstatus zuverlässig bereit?
- Welche wiederholten Toolfehler zeigen in realen oder kontrollierten Läufen
  tatsächlich fehlende Recovery statt berechtigter erneuter Prüfung?

## Wichtige Projektregeln

- Schutzregeln zu Nutzeränderungen, Auftragsscope, Commits/Pushes: siehe
  `AGENTS.md`.
- Nach relevanten Änderungen läuft `npm --prefix npm run verify`. Nur ein
  `project_check`-Aufruf des Pflichtprofils `verify` aktualisiert den
  Footer/Ledger — ein reiner `bash`-Lauf desselben Befehls (auch über den
  `verify`-Tool oder aus `verifier` heraus) tut das nicht (siehe
  `docs/verify-profiles.md`).
- `npm run test:runtime` ist bewusst kein Teil von `verify`/CI: es prüft eine
  lokal gepatchte Runtime unter einem entwicklerspezifischen Pfad
  (`PI_RUNTIME_ROOT`), den kein CI-Runner besitzt (siehe
  `docs/RUNTIME_PATCHES.md`).

## Aktuelle Prioritäten

- Die Snapshot-Basis durch reale Baseline- und Holdout-Läufe absichern.
- Danach Trace-Diagnostik zunächst nur beobachtend ergänzen.

## Verworfene Optionen

- Ein großer allgemeiner Runtime-State, automatische `blocked`-Klassifikation
  und standardmäßig aktive Recovery-Nudges sind verworfen, bis Messdaten
  ihren Nutzen belegen.
