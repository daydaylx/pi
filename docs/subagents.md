# Pi Subagents

Status: Migration zum gepinnten `daydaylx/pi-subagents`-Fork abgeschlossen.

## Zusammenfassung

Die Subagent-Orchestrierung wird durch das Drittanbieter-Paket
[`pi-subagents`](https://github.com/daydaylx/pi-subagents) bereitgestellt, als
unveränderlicher Git-Commit in `settings.json` → `packages` gepinnt. Die vorherige lokale
Implementierung (`extensions/subagents/index.ts`, `agents.ts`,
`runtime-status.ts`) wurde entfernt.

## Warum das vorherige No-Go überarbeitet wurde

Eine frühere Sitzung verzögerte Drittanbieter-Subagent-Pakete bewusst mit
**„No-Go until later: ... without source audit.“** Dieses Audit wurde inzwischen
durchgeführt. Der vollständige Quellcode-Review (alle ~92 `.ts`-Dateien unter `src/`) ergab:

- npm-Tarball byte-identisch zum GitHub-Tag `v0.34.0`.
- Einzelner Maintainer über 89 veröffentlichte Versionen, GitHub Actions Provenance
  Publishing, keine `postinstall`-Hooks.
- Keine Netzwerkaufrufe, Telemetrie oder Exfiltration; die einzige externe Domain ist ein
  Opt-in, nutzerinitiierter Gist-Share (`share: false` standardmäßig).
- Kein `eval`/dynamischer Remote-Code; alle `spawn()`-Aufrufe verwenden Array-Argumente (kein
  Shell-Injection); konsistente Timeout/SIGTERM/SIGKILL-Eskalation.

Urteil: vertrauenswürdig; die Audit-Ergebnisse sind oben zusammengefasst.

## Capability-Grenze

`pi-subagents` versteht die vorherigen `permission`/`writeOverride`/
`allowedPaths`-Frontmatter-Felder nicht und setzt auch nicht die
Umgebungsvariablen `PI_SUBAGENT_PERMISSION_LEVEL`/`PI_SUBAGENT_WRITE_OVERRIDE`/
`PI_SUBAGENT_ALLOWED_PATHS`, die `mode-permissions.ts` früher für gestartete
Kindprozesse auslas (diese Brücke wurde als Dead Code entfernt). Es beschränkt
Kindprozesse über `--tools <list>`, was eine harte Pi-Core-Registry-Grenze ist:
ein weggelassenes Tool kann nicht aufgerufen werden. Reviewer-, Security- und
Exploration-Profile lassen deshalb Bash komplett weg. Der Test-Runner erhält
das lokale `verify`-Tool, das nur die konfigurierten Namen `typecheck`, `test`
und `verify` akzeptiert und die festen Prüfungen dieses Setups aus dem Agent-Verzeichnis
ausführt; es kann keine beliebige Shell-Eingabe übergeben oder Repository-Lifecycle-Skripte
auswählen. Rohe Bash- und Write-Tools bleiben `worker` vorbehalten.

## Installation

Die Laufzeitquelle ist ein geprüfter persönlicher Fork-Commit, kein npm-Range oder
`latest`. Aktualisiere ihn, indem du einen geprüften Fork-Commit veröffentlichst und den
vollständigen SHA in `settings.json` ersetzt.

## Tools und Befehle

- Tool `subagent` (unveränderter Name), plus ein `wait`-Tool für asynchrone Steuerung.
- Modi: `{agent, task}` (einzeln), `{tasks:[...]}` (parallel),
  `{chain:[...]}` (Kette), `{action: "list"}` (Discovery – ersetzt den
  vorherigen `/subagent-list`-Befehl).
- Slash-Commands: `/run`, `/chain`, `/run-chain`, `/parallel`,
  `/subagent-cost`, `/subagents-doctor` (ersetzt `/subagent-doctor`),
  `/subagents-fleet`, `/subagents-stop`, `/subagents-models`,
  `/subagents-profiles`, `/subagents-load-profile`,
  `/subagents-refresh-provider-models`, `/subagents-generate-profiles`,
  `/subagents-check-profile`, `/subagents-watchdog`.

## Agent-Profile

Agenten leben in `agents/*.md` (Nutzer-Scope, da dieses Repository-Verzeichnis
_is_ `~/.pi/agent` ist). Das Frontmatter enthält keine `permission` oder
`writeOverride` mehr — der Zugriff wird vollständig über die `tools:`-Liste gesteuert.

Jedes lokale Profil deklariert die Kontext-Policy explizit:

- `defaultContext: fresh` startet mit einer neuen Child-Unterhaltung. Das Parent-
  Transkript wird nicht in das Child kopiert.
- `inheritProjectContext: true` lädt absichtlich die kompakten globalen und
  Projekt-Kontextdateien, damit Sicherheits- und Architekturregeln weiterhin gelten.
- `inheritSkills: false` hält den Parent-Skill-Katalog aus dem Child heraus,
  es sei denn, die zugewiesene Aufgabe selbst erfordert einen Skill.

Nutze Parent- oder Fork-Kontext nur, wenn die delegierte Aufgabe tatsächlich von
Entscheidungen abhängt, die bereits im Parent-Chat getroffen wurden. Reviews, Repository-
Exploration, Tests, Security-Checks und Second Opinions verwenden standardmäßig frischen
Kontext. Kontext-Vererbung und Projekt-Kontext-Vererbung sind getrennt:
`fresh` isoliert den Chat-Verlauf, unterdrückt aber nicht die absichtlich aktivierten
statischen Projektregeln.

`pi-subagents` liefert 8 eingebaute Agenten (`scout`, `researcher`, `planner`,
`worker`, `reviewer`, `oracle`, `delegate`, `context-builder`). Fünf lokale
Profilnamen kollidieren mit diesen Builtins (`scout`, `oracle`, `planner`,
`reviewer`, `worker`); Agenten im Nutzer-Scope überschatten automatisch Builtins mit
demselben Namen (höchste Discovery-Priorität), sodass die lokalen, bereits
etablierten Prompts und Ausgabeformate ohne Umbenennung wirksam bleiben.

| Agent              | Tools                                   | Notizen                                               |
| ------------------ | --------------------------------------- | ----------------------------------------------------- |
| `scout`            | read, grep, find, ls                    | nur lesend durch Tool-Auslassung                      |
| `planner`          | read, grep, find, ls                    | nur lesend durch Tool-Auslassung                      |
| `architect`        | read, grep, find, ls                    | nur lesend durch Tool-Auslassung                      |
| `reviewer`         | read, grep, find, ls                    | technisch nur lesend                                  |
| `test-runner`      | read, grep, find, ls, verify            | nur allowlistete Verifikation, keine rohe Bash        |
| `security-auditor` | read, grep, find, ls                    | technisch nur lesend                                  |
| `ui-reviewer`      | read, grep, find, ls                    | nur lesend durch Tool-Auslassung                      |
| `docs-auditor`     | read, grep, find, ls                    | nur lesend durch Tool-Auslassung                      |
| `worker`           | read, grep, find, ls, edit, write, bash | voller Schreib-Scope                                  |
| `oracle`           | read, grep, find, ls                    | festes Modell + Thinking; expliziter frischer Kontext |

## Konfiguration

`pi-subagents` liest seine eigene Konfiguration unter
`~/.pi/agent/extensions/subagent/config.json` (optional) plus einen
`settings.json` → `subagents.*` Key. Die aktiven lokalen Werte sind
`parallel.maxTasks` = 8, `parallel.concurrency` = 4,
`globalConcurrencyLimit` = 4 und `maxSubagentSpawnsPerSession` = 24.

Die Paket-Implementierung akzeptiert einen internen `maxOutput`-Wert, aber das
öffentliche Tool-Schema stellt diesen Parameter nicht zuverlässig bereit. Aufrufer dürfen
sich daher nicht darauf verlassen, ihn direkt zu setzen. Die lokale Tool-Output-Absicherung
wendet das Repository-Limit von etwa 50 KiB oder 2.000 Zeilen auf zurückgegebenen Subagent-
Text an, während eine sichtbare Kürzungsmeldung erhalten bleibt. Ein strengeres unterstütztes
Limit muss strenger bleiben.

## Ergebnisvertrag

Subagenten liefern einen kompakten Endbericht mit genau diesen Top-Level-Abschnitten:

```markdown
## Ergebnis

## Belege

## Betroffene Dateien

## Fehler oder Risiken

## Offene Fragen

## Empfehlung
```

Rollenspezifischer Inhalt gehört in diese gemeinsame Struktur. Gib nur den
Endbericht an den Parent-Kontext zurück; kopiere niemals ein vollständiges Child-Transkript,
rohes Tool-Log oder versteckte Schlussfolgerungen hinein. Session-Artefakte können zur
Diagnose im konfigurierten Session-Storage verbleiben, werden aber nicht in die
Parent-Unterhaltung zurückinjiziert.

## UI-Integration

Aurora besitzt den einzigen angepassten Editor, Footer und Activity-Widget. Die lokale
`extensions/subagent/config.json` deaktiviert das permanente asynchrone Widget des Pakets und
begrenzt sowohl lokale als auch globale Parallelität auf vier. Subagent-Lifecycle-Tracking,
Status-Befehle und Completion-Notifications bleiben verfügbar, ohne einen zweiten persistenten
UI-Besitzer.

## Delegationskriterien

Die kompakte Regel in `AGENTS.md` entscheidet, wann Delegation angemessen ist. Dieses
Dokument ist die detaillierte Referenz für Profilauswahl, Kontext-Isolation,
Ergebnisformatierung und Betriebsgrenzen.
