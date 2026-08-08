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
- Der Verifikationsstatus ist sitzungsgebunden, an den gemeinsamen
  Workspace-Snapshot gebunden und rein technisch. Er erscheint dedupliziert
  bei `agent_settled`, ist abschaltbar und nutzt weder `agent_end` als
  Erledigung noch Heuristiken als `blocked`.
- Aurora ist alleiniger Besitzer der TUI-Chrome inklusive Fußzeile
  (`docs/decisions/007`, `docs/decisions/009`).
- Es gibt genau drei aktive Subagentenrollen — `investigator`, `debugger`,
  `verifier` (`docs/decisions/011`).

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
- Nach relevanten Änderungen läuft `npm --prefix npm run verify`.

## Aktuelle Prioritäten

- Die Snapshot-Basis durch reale Baseline- und Holdout-Läufe absichern.
- Danach Trace-Diagnostik zunächst nur beobachtend ergänzen.

## Verworfene Optionen

- Ein großer allgemeiner Runtime-State, automatische `blocked`-Klassifikation
  und standardmäßig aktive Recovery-Nudges sind verworfen, bis Messdaten
  ihren Nutzen belegen.
