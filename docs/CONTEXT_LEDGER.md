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
- Der kanonische Verify-Lauf bleibt derzeit außerhalb des AP3-Scopes rot:
  `extensions/aurora-ui/index.ts` liegt mit 97,4 % unter der geforderten
  100-%-Coverage. Der Befund ist nach AP3 bestätigt, die Datei ist nicht Teil
  des AP3-Diffs.

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
  Footer/Ledger — ein reiner `bash`-Lauf desselben Befehls (auch über den
  `verify`-Tool oder aus `verifier` heraus) tut das nicht (siehe
  `docs/verify-profiles.md`).
- `npm run test:runtime` ist bewusst kein Teil von `verify`/CI: es prüft eine
  lokal gepatchte Runtime unter einem entwicklerspezifischen Pfad
  (`PI_RUNTIME_ROOT`), den kein CI-Runner besitzt (siehe
  `docs/RUNTIME_PATCHES.md`).

## Aktuelle Prioritäten

- P2-Cleanup: Restkomplexität, Dokumentation, Knip-Regeln.
- Die verbleibenden Arbeitspakete aus `resprobleme_auftrag` in der festgelegten
  Reihenfolge fortsetzen; AP1–AP3 sind abgeschlossen.

## Verworfene Optionen

- Ein großer allgemeiner Runtime-State, automatische `blocked`-Klassifikation
  und standardmäßig aktive Recovery-Nudges sind verworfen, bis Messdaten
  ihren Nutzen belegen.
