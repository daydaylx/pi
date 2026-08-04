# Pi Subagents

Die Orchestrierung stammt aus dem exakt gepinnten
`daydaylx/pi-subagents`-Fork. Paket-Builtins sind in `settings.json` mit
`subagents.disableBuiltins: true` vollständig deaktiviert, damit keine
überlappenden Rollen im Agent-Katalog erscheinen.

## Aktive Rollen

| Rolle          | Tools                      | Verantwortung                                                                    |
| -------------- | -------------------------- | -------------------------------------------------------------------------------- |
| `investigator` | read, grep, find, ls       | unbekannte Änderungssurface oder Kontrollfluss belegt eingrenzen                 |
| `debugger`     | read, grep, find, ls, bash | unbekannte, intermittierende oder gescheiterte Bugs reproduzieren und eingrenzen |
| `verifier`     | read, grep, find, ls, bash | nichttriviale Umsetzung unabhängig gegen Auftrag, Diff und Checks prüfen         |

Der Hauptagent plant, implementiert, triagiert und kommuniziert das finale
Ergebnis. Kleine, klar lokalisierte Änderungen bleiben beim Hauptagenten.
Normale Änderungen mit bekannter Änderungssurface plant und implementiert der
Hauptagent ebenfalls selbst.
`investigator` wird nur bei unbekanntem Bereich oder relevanter
Änderungssurface gestartet; `debugger` nur bei unbekannten, intermittierenden
oder gescheiterten Bugs; `verifier` nur für eine unabhängige Prüfung nach einer
nichttrivialen Umsetzung. Es gibt keine automatische Pflichtdelegation und
keine verschachtelte Delegation.

Alle lokalen Profile starten laut Profil-Tools mit frischem Child-Kontext,
übernehmen die statischen Projektregeln und nicht automatisch den
Parent-Skill-Katalog. Ihre Toolliste erlaubt keine verschachtelte Delegation.
Sie ist zugleich die technische Capability-Grenze: Keines der drei Profile
besitzt `edit` oder `write`. `debugger` und `verifier` dürfen technisch Shell
ausführen, ihre Profile verbieten aber ausdrücklich Projektänderungen; der
Hauptagent bleibt alleiniger regulärer Patch-Eigentümer.

## Direkte Laufzeitquellen

- `settings.json`: `subagents.disableBuiltins: true` deaktiviert alle
  Paket-Builtins.
- `extensions/subagent/config.json`: die aktive Paketkonfiguration setzt
  `parallel.maxTasks: 4`, `parallel.concurrency: 3`,
  `globalConcurrencyLimit: 3` und `maxSubagentSpawnsPerSession: 12`.
- Die Frontmatter der drei Profile: `defaultContext: fresh`,
  `inheritProjectContext: true`, `inheritSkills: false` und ihre jeweilige
  Toolliste. Keines der Profile hat ein Delegations-Tool.

## Ergebnisbudget und Artefakte

Die generische Tool-Ausgabegrenze bleibt unverändert. Für Ergebnisse des
`subagent`-Tools gilt zusätzlich ein eigener Backstop von 12 KiB oder 240
Zeilen. Bei einer Kürzung bleiben Anfang und Ende des zusammengeführten
Textes sichtbar; strukturierte Nicht-Text-Blöcke bleiben erhalten.

Die Antwortdetails bleiben ebenfalls erhalten und erhalten ergänzend die
Kürzungsmetadaten (`details.truncation`). Das ist eine strukturierte
Laufzeitangabe für spätere Diagnose und keine Persistenz von Prompt- oder
Tool-Inhalten. Die Paket-Artefakte und `status` bleiben die Quelle für
asynchrone Run-Informationen.

Read-only Rollen liefern ihre Befunde inline. Aufrufer geben ihnen keinen
`output`-Pfad vor; bei Bedarf werden die Paket-Artefakte statt einer vom Kind
zu schreibenden Zieldatei verwendet.

## Betriebsgrenzen

- Keine automatische Installation oder Aktualisierung des Pakets.
- Keine Secrets, Auth-Dateien oder Umgebungsdumps in Tasks oder Reports.
- Asynchrone Runs werden über die Paket-Artefakte bzw. `status` beobachtet,
  nicht über Terminal-Scraping.
- Delegation folgt den harten Kriterien in `AGENTS.md`.
- Allgemeine Aufgaben delegieren nur, wenn die Projektregeln es rechtfertigen.
