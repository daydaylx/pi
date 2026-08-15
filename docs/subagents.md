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
| `verifier`     | read, grep, find, ls, bash | riskante Umsetzung unabhängig gegen Auftrag, Diff und Checks prüfen              |

Der Hauptagent plant, implementiert, triagiert und kommuniziert das finale
Ergebnis. Kleine, klar lokalisierte Änderungen bleiben beim Hauptagenten.
Normale Änderungen mit bekannter Änderungssurface plant und implementiert der
Hauptagent ebenfalls selbst.
`investigator` wird nur bei unbekanntem Bereich oder unklarer
Änderungssurface gestartet; `debugger` nur bei unbekannten, intermittierenden
oder gescheiterten Bugs. Wann der `verifier` verpflichtend und wann er optional
ist, steht in `AGENTS.md`: maßgeblich ist der Risikofaktor der Änderung, nicht
die Zahl der berührten Dateien. Es gibt keine verschachtelte Delegation.

Alle lokalen Profile starten laut Profil-Tools mit frischem Child-Kontext,
übernehmen die statischen Projektregeln und nicht automatisch den
Parent-Skill-Katalog. Ihre Toolliste erlaubt keine verschachtelte Delegation.
Sie ist zugleich die technische Capability-Grenze: Keines der drei Profile
besitzt `edit` oder `write`. `debugger` und `verifier` dürfen technisch Shell
ausführen, ihre Profile verbieten aber ausdrücklich Projektänderungen; der
Hauptagent bleibt alleiniger regulärer Patch-Eigentümer.

`agents/verifier.md` läuft auf `zai/glm-5.2` mit
`openai-codex/gpt-5.6-terra` als `fallbackModels`. Beide Modell-IDs stehen in
`settings.enabledModels`, und der Fork wertet `fallbackModels` aus; sonst wäre
der Fallback eine Angabe ohne Wirkung.

## Reduzierte Tool-Surface

`extensions/subagent/config.json` setzt zwei getrennte Schalter:

- `toolSchemaMode: "harness"` bestimmt allein, welche Parameter das
  `subagent`-Tool annimmt: SINGLE-Ausführung sowie die vier
  Management-Aktionen `list`, `status`, `stop` und `interrupt`. `action` ist
  ein geschlossenes Enum, und das Schema lehnt zusätzliche Eigenschaften ab.
  Chain, Parallel, Agent-CRUD, Scheduling, Worktrees, Sharing, Watchdog,
  `resume`, `steer` und `append-step` scheitern damit bereits an der
  Argumentvalidierung, bevor der Executor läuft.
- `toolDescriptionMode: "custom"` bestimmt ausschließlich den sichtbaren
  Beschreibungstext. Die agentweite `subagent-tool-description.md` reduziert
  die für das Modell sichtbare Tool-Beschreibung auf die drei aktiven Rollen
  und wann sie sich lohnen; eine `.pi/subagent-tool-description.md` des
  geöffneten Projekts darf diese Standardbeschreibung gezielt übersteuern. Die
  zwingende Sicherheits-Guidance des Pakets bleibt über `{{safetyGuidance}}`
  automatisch Teil der gerenderten Beschreibung.

Die beiden Schalter waren früher gekoppelt: `toolDescriptionMode: "custom"`
registrierte zugleich das reduzierte Schema. Siehe
`docs/decisions/014-reduced-subagent-tool-surface.md`.

`/setup-doctor` meldet beide Werte und die aktive Surface; im Fork meldet
`subagent({ action: "doctor" })` dasselbe unter `Tool surface`.

## Direkte Laufzeitquellen

- `settings.json`: `subagents.disableBuiltins: true` deaktiviert alle
  Paket-Builtins; `packages` pinnt den Fork auf einen vollständigen,
  erreichbaren Commit-SHA.
- `extensions/subagent/config.json`: `toolSchemaMode: "harness"`,
  `toolDescriptionMode: "custom"`, `maxSubagentSpawnsPerSession: 5` sowie
  `ui.showAsyncWidget: false` und `ui.fleetView: false`. Es gibt keine
  Parallelitäts- oder Concurrency-Konfiguration mehr — das aktive Harness
  führt keine parallelen Subagenten aus, und `/setup-doctor` meldet eine
  wieder auftauchende Parallelitätskonfiguration als Fehler.
- Die Frontmatter der drei Profile: `defaultContext: fresh`,
  `inheritProjectContext: true`, `inheritSkills: false` und ihre jeweilige
  Toolliste. Keines der Profile hat ein Delegations-Tool.

## Delegationsvorlage

Fresh-Context-Subagenten sehen den Parent-Dialog nicht automatisch. Das
`task`-Feld ist deshalb die einzige Quelle des Originalauftrags und trägt ihn
wortgetreu, nicht als eigene Zusammenfassung:

```text
Original User Request:
<ursprünglicher Nutzerauftrag wortgetreu>

Constraints / Non-Goals:
<verbindliche Grenzen und Nicht-Ziele, sofern vorhanden>

Delegated Question:
<konkrete Teilfrage an den Subagenten>
```

Für `verifier` zusätzlich:

```text
Implementation / Diff to verify:
<geänderte Dateien bzw. relevanter Diff, Implementation Surface>

Pre-existing workspace state (vor der ersten Änderung dieses Tasks erfasst):
<Ausgabe von `git status --short` zu Taskbeginn, oder „clean" falls keine>

Pre-existing dirty-path fingerprints:
<Content-Fingerprint je vorbestehend geändertem Pfad, inklusive Marker für
fehlende Dateien; mindestens für jeden Pfad, den der Task ebenfalls ändert>
```

`git status --short` allein ist keine Inhaltsbaseline: Es zeigt nicht, ob der
Task eine bereits vorher veränderte Datei zusätzlich geändert hat. Vor der
ersten Task-Änderung deshalb reproduzierbare Content-Fingerprints (Hash des
Dateiinhalts beziehungsweise ein eindeutiger Abwesenheitsmarker) erfassen.
Mindestens jeder vorbestehend schmutzige Pfad, den der Task ebenfalls berührt,
muss damit abgedeckt sein; ohne diesen Nachweis bleibt eine Same-Path-
Abgrenzung ausdrücklich unverifizierbar.

Für den `subagent`-Tool-Aufruf selbst kein eng geschätztes `turnBudget` raten:
`agents/verifier.md` setzt bereits ein großzügiges `timeoutMs` (aktuell
1200000 ms); darauf verlassen statt `maxTurns`/`graceTurns` aus der Patchgröße
abzuleiten. Wird dennoch ein `turnBudget` gesetzt, großzügig wählen — nicht
knapper, als eine vollständige Verifikation in diesem Repo (mehrere Suiten,
700+ Tests) realistisch braucht.

Das ist Kontextübergabe im vorhandenen `task`-Feld, kein neuer Zustand, keine
ID und keine Persistenz. Die Rollenprofile in `agents/*.md` beschreiben unter
„Eingabe, die du benötigst" dieselbe Struktur aus Empfängersicht.

## Ergebnisbudget und Artefakte

Die reduzierte API nimmt keine Ausgabepfade, Kontext-, Skill-, Arbeitsverzeichnis-
oder Modellparameter entgegen. Da `investigator`, `debugger` und `verifier`
schreibgeschützt bleiben (kein `edit`/`write`), landen ihre Befunde inline im
Abschlussbericht statt in einer Datei, die ein Kind-Prozess schreiben müsste:
Aufrufer geben ihnen keinen
`output`-Pfad vor. Ergebnisse gehören zum einzelnen Run; `list`
und `status` liefern die Laufzeitübersicht. Es gibt keine Chain-, Parallel-,
Worktree- oder Delegations-API.

## Betriebsgrenzen

- Keine automatische Installation oder Aktualisierung des Pakets.
- Keine Secrets, Auth-Dateien oder Umgebungsdumps in Tasks oder Reports.
- Asynchrone Runs werden über die Paket-Artefakte bzw. `status` beobachtet,
  nicht über Terminal-Scraping.
- Delegation folgt den harten Kriterien in `AGENTS.md`.
- Allgemeine Aufgaben delegieren nur, wenn die Projektregeln es rechtfertigen.
