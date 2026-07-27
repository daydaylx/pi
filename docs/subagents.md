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
| `reviewer` | read, grep, find, ls | unabhängiger Diff-, Scope- und Abschlussreview |

Ein `researcher` ist optional vorgesehen, aber ohne Web-Toolchain nicht
installiert. Die früheren lokalen Rollen `scout`, `oracle` und `test-runner`
sowie überlappende Paket-Builtins sind nicht aktiv.

Alle lokalen Profile starten standardmäßig mit frischem Child-Kontext,
übernehmen die statischen Projektregeln und nicht automatisch den
Parent-Skill-Katalog. Die Toolliste ist die technische Capability-Grenze:
nur der Worker besitzt Schreib- und Shell-Tools.

## Completion-RPC

Plan-mode nutzt ausschließlich den versionierten In-Process-Vertrag:

- Request: `subagents:rpc:v1:request`
- Reply: `subagents:rpc:v1:reply:<requestId>`
- Methoden: asynchrones `spawn` des lokalen `reviewer`, anschließend `status`

Der Reviewer arbeitet lesend mit PlanSnapshot, Diff-Fingerprint,
Dateiliste, Scope-Befunden und Check-Ergebnissen. Sein letzter nichtleerer
Output muss exakt einer dieser Marker sein:

```text
[COMPLETION-REVIEW:PASS]
[COMPLETION-REVIEW:REWORK]
[COMPLETION-REVIEW:UNVERIFIABLE]
```

Fehlender, mehrfacher oder nicht abschließender Marker wird als
`UNVERIFIABLE` behandelt. Der Parent übernimmt niemals ein Child-Transkript
als fachliche Quelle.

## Betriebsgrenzen

- Keine automatische Installation oder Aktualisierung des Pakets.
- Keine Secrets, Auth-Dateien oder Umgebungsdumps in Tasks oder Reports.
- Asynchrone Runs werden über die Paket-Artefakte bzw. `status` beobachtet,
  nicht über Terminal-Scraping.
- Delegation folgt den harten Kriterien in `AGENTS.md`.
- Completion startet immer genau einen unabhängigen Reviewer; allgemeine
  Aufgaben delegieren nur, wenn die Projektregeln es rechtfertigen.
