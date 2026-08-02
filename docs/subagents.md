# Pi Subagents

Die Orchestrierung stammt aus dem exakt gepinnten
`daydaylx/pi-subagents`-Fork. Paket-Builtins sind in `settings.json` mit
`subagents.disableBuiltins: true` vollständig deaktiviert, damit keine
überlappenden Rollen im Agent-Katalog erscheinen.

## Kernrollen

| Rolle | Tools | Verantwortung |
| --- | --- | --- |
| `planner` | read, grep, find, ls | Quick-/Architekturplanung und Systemgrenzen, nur lesend |
| `worker` | read, grep, find, ls, edit, write, bash | eng abgegrenzte Umsetzung und relevante Checks |
| `reviewer` | read, grep, find, ls | unabhängige, auf Nutzerauftrag gestartete Prüfung |

Kleine Aufgaben bleiben beim Hauptagenten oder gehen an den Worker. Der
Hauptagent oder Planner analysiert und plant; der Worker setzt um und führt
relevante Tests aus. Der Reviewer prüft nur gezielt und manuell auf
ausdrücklichen Auftrag. Es gibt keine automatische Completion und keine
weiteren ausführbaren lokalen Rollen.

Alle lokalen Profile starten laut Profil-Tools mit frischem Child-Kontext,
übernehmen die statischen Projektregeln und nicht automatisch den
Parent-Skill-Katalog. Ihre Toolliste erlaubt keine verschachtelte Delegation.
Sie ist zugleich die technische Capability-Grenze: Nur der Worker besitzt
Schreib- und Shell-Tools.

## Direkte Laufzeitquellen

- `settings.json`: `subagents.disableBuiltins: true` deaktiviert alle
  Paket-Builtins.
- `extensions/subagent/config.json`: die aktive Paketkonfiguration setzt
  `parallel.maxTasks: 4`, `parallel.concurrency: 3`,
  `globalConcurrencyLimit: 3` und `maxSubagentSpawnsPerSession: 12`.
- Die Frontmatter der drei Profile: `defaultContext: fresh`,
  `inheritProjectContext: true`, `inheritSkills: false` und ihre jeweilige
  Toolliste. Keines der Profile hat ein Delegations-Tool.

## Betriebsgrenzen

- Keine automatische Installation oder Aktualisierung des Pakets.
- Keine Secrets, Auth-Dateien oder Umgebungsdumps in Tasks oder Reports.
- Asynchrone Runs werden über die Paket-Artefakte bzw. `status` beobachtet,
  nicht über Terminal-Scraping.
- Delegation folgt den harten Kriterien in `AGENTS.md`.
- Allgemeine Aufgaben delegieren nur, wenn die Projektregeln es rechtfertigen.
