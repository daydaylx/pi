# Pi Context Audit

Datum: 2026-07-15  
Arbeitsverzeichnis: `/home/d/.pi/agent`  
Sicherung: `/home/d/.pi/agent/backups/pi-context-audit/20260715-232411`
UI-Folgesicherung: `/home/d/.pi/agent/backups/20260716-002807-ui-redesign`
(neun Nutzdateien plus `manifest.sha256`, vollständig verifiziert)

## Kurzfazit

Das Setup nutzt Pi Core als einziges Compaction-System und besitzt keine
automatisch konkurrierende Memory-Extension. Die größten Kontextkosten kamen
aus der dauerhaft geladenen globalen `AGENTS.md`, der vollständigen
Subagenten-Toolbeschreibung, wiederholten versteckten Plan-Modus-Nachrichten
und potenziell unbegrenzten Resultaten eigener LSP- und Subagenten-Tools.

Die risikoarmen Ursachen wurden lokal behoben. Das ursprüngliche Kontext-Audit
nahm keine Provider- oder Modellumstellung vor. Während der Abschlussprüfung
änderte sich `settings.json` parallel auf
`openrouter/cohere/north-mini-code:free`; diese Nutzeränderung und zwei
ergänzte Modellfreigaben wurden erhalten. Compaction-Werte, Paket-Pins,
Session-Historie und UI blieben im ursprünglichen Kontext-Audit unverändert;
die späteren UI-Änderungen sind separat ab dem UI-Folgeaudit dokumentiert.

## Installation und Runtime

| Merkmal | Ermittelte Realität | Bewertung |
| --- | --- | --- |
| Pi-Binary | `/home/d/.npm-global/bin/pi` → `/home/d/.npm-global/lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js` | aktiv |
| Pi-Runtime | `@earendil-works/pi-coding-agent` 0.80.7 | aktiv |
| Lokale Dev-Abhängigkeit | `npm/node_modules/@earendil-works/pi-coding-agent` 0.80.6 | Versionsabweichung dokumentiert, nicht automatisch geändert |
| Node / npm | 22.22.2 / 10.9.7 | passend zu `npm/package.json` |
| Globale Konfiguration | `/home/d/.pi/agent/settings.json` | aktiv |
| Projekt-Settings | keine `/home/d/.pi/agent/.pi/settings.json` | kein versteckter Override |
| Custom-Modeldatei | keine aktive `models.json` | Built-in-Registry maßgeblich |
| Session-Speicher | `/home/d/.pi/agent/sessions`, aktuell 109 JSONL-Dateien, ca. 52,5 MB | nur gewählte Session geladen |

`auth.json` wurde nicht inhaltlich gelesen und ist weder Teil der Sicherung
noch dieses Reports.

## Kontextquellen

Die tatsächliche Ladefolge wurde gegen Pis `loadProjectContextFiles()` geprüft.
Pi lädt zunächst den globalen Agent-Kontext und durchsucht danach alle
Elternverzeichnisse bis zur Dateisystemwurzel; es stoppt nicht an der Git-Wurzel.
Pro Verzeichnis gewinnt die erste vorhandene Datei in der Reihenfolge
`AGENTS.md`, `AGENTS.MD`, `CLAUDE.md`, `CLAUDE.MD`.

| Ressource | Pfad | Global/Projekt | Wird geladen? | Zweck | Größe | Überschneidungen | Risiko |
| --- | --- | --- | --- | --- | ---: | --- | --- |
| Globale Regeln | `/home/d/.pi/agent/AGENTS.md` | global | ja, zuerst | Schutz, Kontextdisziplin, Sessions, knappe Delegation | 2.626 B / 36 Zeilen | Detailregeln ausgelagert | niedrig |
| Leere Elternregel | `/home/d/CLAUDE.md` | Elternpfad | ja, leer | keiner | 0 B | tote Ressource | niedrig; bewusst belassen |
| Pi-Projektkarte | `/home/d/.pi/AGENTS.md` | Projekt/Elternpfad | ja, zuletzt | Architektur, Verzeichnisse, Verify, gezielte Doku | 1.784 B / 36 Zeilen | ergänzt globale Regeln | niedrig |
| `SYSTEM.md` | global und Projekt | — | nein, nicht vorhanden | kein Ersatz des Core-Prompts | 0 | keine | gut |
| `APPEND_SYSTEM.md` | global und Projekt | — | nein, nicht vorhanden | kein permanenter Zusatzprompt | 0 | keine | gut |
| Projektstatus | `docs/PROJECT_STATE.md` | Projekt | nur bedarfsgesteuert | aktueller Arbeitsstand | unter 250 Zeilen | kein Chatprotokoll | niedrig |
| Lokale Skills | `skills/*/SKILL.md`, 11 Stück | global | nur Metadaten dauerhaft, Body bei Aufruf | wiederverwendbare Workflows | 930–1.968 B je Skill | einige thematische Prompt-Alternativen | niedrig |
| Paket-Skill | `pi-subagents/skills/pi-subagents/SKILL.md` | Paket | Metadaten dauerhaft, 72-KB-Body nur bei Aufruf | vollständige Subagentendoku | ca. 72 KB / 950 Zeilen | Toolbeschreibung und `docs/subagents.md` | hoch nur bei unnötigem Aufruf |
| Aktueller Plan | `.agent/plans/current-plan.md` | Projekt | nur durch Plan-Extension im aktiven Workflow | Umsetzungsplan | ca. 12 KB beim Audit | Plan-Modus-Nachrichten | nach Filter mittel |
| Archivpläne | `.agent/plans/archive/`, `docs/archive/` | Projekt | nein | Historie | variabel | keine aktive Injektion | niedrig |
| Sessions | `sessions/` | global, nach CWD gruppiert | nur gewählte Session | Gesprächsbaum und Compactions | ca. 52,5 MB | keine globale Memory-Injektion | Speicher beobachten |
| Subagenten-Artefakte | `.pi-subagents/` | global | nein | Diagnose/Child-Transkripte | separat | keine Parent-Injektion | Datenschutz/Aufbewahrung beobachten |

Weitere `AGENTS.md`, `CLAUDE.md`, `.pi/`- und `.agents/`-Ressourcen anderer
Projekte unter `/home/d` wurden inventarisiert, sind für dieses CWD aber nicht
geladen. Die leere `/home/d/CLAUDE.md` bleibt die einzige unerwartete
Elternressource und hat keine Tokenwirkung.

## Skills, Templates und Modi

- Skills werden von Pi nur mit Name, Beschreibung und Pfad katalogisiert; der
  vollständige Body wird erst über `/skill:<name>` geladen.
- Ein Checkpoint-Duplikat existierte nicht. Der neue Skill
  `context-checkpoint` ergänzt die bestehenden Analyse-, Test-, Review- und
  Dokumentationsskills ohne dauerhafte Body-Injektion.
- Prompt-Templates überschneiden sich teilweise mit Skills (`analyse`/
  `repo-analyse`, `docs-check`/`agent-docs`, `review`/Reviewer-Profile). Sie
  sind nicht dauerhaft geladen und wurden deshalb nicht entfernt.
- Eigene Plan-, Review-, Decision- und Work-Phasen werden von
  `extensions/plan-mode` verwaltet. Alte versteckte Phasennachrichten werden
  jetzt vor der letzten terminalen Assistant-Antwort aus dem Provider-Kontext
  entfernt. Zwischenantworten mit Toolcalls behalten die aktive Anweisung.

### Vollständiges lokales Ressourceninventar

| Typ | Pfad | Größe | Ladeverhalten | Bewertung |
| --- | --- | ---: | --- | --- |
| Skill | `skills/agent-docs/SKILL.md` | 1.179 B | Metadaten / bei Aufruf | aktiv |
| Skill | `skills/bug-triage/SKILL.md` | 951 B | Metadaten / bei Aufruf | aktiv |
| Skill | `skills/context-checkpoint/SKILL.md` | 1.968 B | Metadaten / bei Aufruf | neu, aktiv |
| Skill | `skills/doc-diff/SKILL.md` | 1.018 B | Metadaten / bei Aufruf | aktiv |
| Skill | `skills/git-check/SKILL.md` | 1.021 B | Metadaten / bei Aufruf | aktiv |
| Skill | `skills/prompt-compiler/SKILL.md` | 1.233 B | Metadaten / bei Aufruf | aktiv |
| Skill | `skills/release-changelog/SKILL.md` | 1.045 B | Metadaten / bei Aufruf | aktiv |
| Skill | `skills/repo-analyse/SKILL.md` | 1.007 B | Metadaten / bei Aufruf | aktiv |
| Skill | `skills/security-audit/SKILL.md` | 1.082 B | Metadaten / bei Aufruf | aktiv |
| Skill | `skills/test-ci/SKILL.md` | 966 B | Metadaten / bei Aufruf | aktiv |
| Skill | `skills/ui-ux-review/SKILL.md` | 930 B | Metadaten / bei Aufruf | aktiv |
| Paket-Skill | `git/github.com/daydaylx/pi-subagents/skills/pi-subagents/SKILL.md` | 72.124 B | Metadaten / bei Aufruf | nur gezielt laden |
| Prompt | `prompts/analyse.md` | 649 B | nur bei Aufruf | Überschneidung mit Repo-Analyse |
| Prompt | `prompts/docs-check.md` | 654 B | nur bei Aufruf | Überschneidung mit Doku-Skills |
| Prompt | `prompts/review.md` | 904 B | nur bei Aufruf | Überschneidung mit Reviewer |
| Prompt | `prompts/ui-review.md` | 689 B | nur bei Aufruf | Überschneidung mit UI-Skill |
| Paket-Prompt | `pi-subagents/prompts/gather-context-and-clarify.md` | 756 B | nur bei Aufruf | aktiv verfügbar |
| Paket-Prompt | `pi-subagents/prompts/parallel-cleanup.md` | 4.270 B | nur bei Aufruf | aktiv verfügbar |
| Paket-Prompt | `pi-subagents/prompts/parallel-context-build.md` | 3.150 B | nur bei Aufruf | aktiv verfügbar |
| Paket-Prompt | `pi-subagents/prompts/parallel-handoff-plan.md` | 3.619 B | nur bei Aufruf | aktiv verfügbar |
| Paket-Prompt | `pi-subagents/prompts/parallel-research.md` | 2.523 B | nur bei Aufruf | aktiv verfügbar |
| Paket-Prompt | `pi-subagents/prompts/parallel-review.md` | 3.497 B | nur bei Aufruf | aktiv verfügbar |
| Paket-Prompt | `pi-subagents/prompts/review-loop.md` | 3.688 B | nur bei Aufruf | aktiv verfügbar |
| Agentprofil | `agents/architect.md` | 1.101 B | nur Subagent | aktiv |
| Agentprofil | `agents/docs-auditor.md` | 1.023 B | nur Subagent | aktiv |
| Agentprofil | `agents/oracle.md` | 1.161 B | nur Subagent | aktiv |
| Agentprofil | `agents/planner.md` | 1.384 B | nur Subagent | aktiv |
| Agentprofil | `agents/reviewer.md` | 1.430 B | nur Subagent | aktiv |
| Agentprofil | `agents/scout.md` | 1.224 B | nur Subagent | aktiv |
| Agentprofil | `agents/security-auditor.md` | 1.219 B | nur Subagent | aktiv |
| Agentprofil | `agents/test-runner.md` | 1.202 B | nur Subagent | aktiv |
| Agentprofil | `agents/ui-reviewer.md` | 1.158 B | nur Subagent | aktiv |
| Agentprofil | `agents/worker.md` | 1.376 B | nur Subagent | aktiv |

`/home/d/.agents` und `/home/d/.pi/agent/.agents` enthalten für dieses Setup
keine zusätzlichen geladenen Ressourcen.

## Provider, Modell und Compaction

| Einstellung | Ist-Wert | Bewertung |
| --- | ---: | --- |
| Provider / registrierter Name | `openrouter` / `cohere/north-mini-code:free` | Built-in-Registry, kein Custom-Override |
| Pi-`contextWindow` | 256.000 Tokens | stimmt mit der offiziellen Providerangabe von 256K überein |
| Pi-`maxTokens` | 64.000 Tokens | stimmt mit der Providerangabe von bis zu 64K überein |
| Auto-Compaction | aktiviert | Core ist alleiniger Eigentümer |
| `reserveTokens` | 32.768 | konservativ für ca. 256K |
| `keepRecentTokens` | 12.000 | relevanzorientiert; kein Verlust nachgewiesen |
| Schwellenwert | 223.232 Tokens (87,2 %) | rechtzeitig vor Fensterende |
| Branch Summary | Reserve 16.384, `skipPrompt: true` | `/tree` fasst ohne explizite Wahl standardmäßig nicht zusammen |
| Thinking | Standard `high` 32.768; `xhigh` 100.000 | `xhigh` übersteigt den registrierten 64K-Ausgaberahmen und bleibt Prüfrisiko |

Pi erkennt gängige OpenRouter-Overflow-Muster und versucht einmalig
Compaction plus Retry. Projektbezogene Compaction-Overrides existieren nicht.
Die Werte wurden mangels Fehlbeleg nicht verändert. Wenn reale Compactions
Entscheidungen verlieren, ist zuerst ein kontrollierter Test von
`keepRecentTokens` im Bereich 24K–32K sinnvoll, nicht eine proportionale
Aufblähung aller Werte.

Zu Auditbeginn war noch `tencent/hy3:free` aktiv, das OpenRouter zum
21. Juli 2026 abkündigt. Die parallel vorgenommene Umstellung auf North Mini
Code beseitigt dieses unmittelbare Betriebsrisiko. OpenRouter nennt für das
neue kostenlose Modell 256K Kontext, bis zu 64K Ausgabe sowie Tool- und
Reasoning-Unterstützung. Die Diskrepanz zwischen `xhigh: 100000` und 64K
Ausgabe wird nicht blind verändert, sondern nach realer Nutzung bewertet.
Quellen: <https://openrouter.ai/tencent/hy3%3Afree>,
<https://openrouter.ai/cohere/north-mini-code%3Afree>

## Tool-Ausgaben

- Pis Built-ins begrenzen normale Resultate bereits auf 2.000 Zeilen und
  50 KiB. Bash behält dabei das Ende, damit Fehler sichtbar bleiben.
- `pi-tool-display` beeinflusst nur die TUI-Darstellung, nicht das kanonische
  ToolResult im Modellkontext. Truncation-Hinweise sind jetzt sichtbar.
- Eigene LSP-Resultate durchlaufen nun dieselbe zentrale Grenze und erhalten
  bei Kürzung `details.truncation`.
- `pi-subagents` besitzt intern einen Head-only-`maxOutput`-Truncator,
  exponiert ihn in der installierten Version aber nicht zuverlässig im
  öffentlichen Tool-Schema. Er wird lokal nicht automatisch aktiviert. Ein
  eigener `tool_result`-Guard begrenzt stattdessen das vollständige Endresultat
  ausgewogen. Anfang und Ende sowie ein Kürzungsmarker bleiben erhalten.
- Arbeitsregeln verlangen gezielte Suche, Filter, `git diff --stat`,
  dateibezogene Diffs und kompakte Testergebnisse. `!!command` ist nur für
  nutzersichtbare, nicht modellrelevante Ausgaben vorgesehen.

## Subagenten-Kontextisolation

- `fresh` erzeugt eine neue Child-Unterhaltung; Parent-Chat und vollständige
  Child-Transkripte werden nicht in den Hauptkontext kopiert.
- Wegen einer Formatinkompatibilität zwischen Pi 0.80.7s `<project_context>`
  und dem Paketfilter wäre `inheritProjectContext: false` derzeit nicht
  verlässlich. Alle lokalen Profile setzen deshalb bewusst
  `inheritProjectContext: true`: schlanke Sicherheits- und Projektregeln sind
  statisch verfügbar, die Unterhaltung bleibt dennoch frisch.
- `inheritSkills: false` verhindert das unnötige Erben des Skill-Katalogs.
- Fork-/Parent-Kontext wird nur verwendet, wenn eine Teilaufgabe tatsächlich
  von früheren Nutzerentscheidungen abhängt.
- Alle Profile liefern dasselbe kompakte, sechsteilige Ergebnisformat.

## Extension-Matrix

| Extension | Funktion / relevante Hooks | Kontextwirkung | Überschneidung | Risiko | Empfehlung |
| --- | --- | --- | --- | --- | --- |
| `plan-mode` | `context`, `before_agent_start`, Turn-/Session-Hooks | aktive Modusanweisung; alte Scaffolding-Nachrichten gefiltert | aktueller Plan | mittel | behalten und Regressionstest pflegen |
| `mode-permissions` | Tool-/Bash-Entscheidungen | keine Prompt-Injektion | Sicherheitsregeln | niedrig | behalten |
| `activity-status` | Agent-/Message-/Tool-Lifecycle | nur UI | früher Hidden-Thinking-Label | niedrig | alleiniger Working-Message-/Indicator-Eigentümer |
| `thinking-view` | Thinking-/Statusdarstellung | keine Reasoning-Injektion | Status im Cockpit bewusst ausgeblendet | niedrig | alleiniger Hidden-Thinking-Label-Eigentümer |
| `ask-user` | eigenes Fragetool | nur Aufruf und Ergebnis | keine | niedrig | behalten |
| `lsp` | fünf eigene Tools | Schemas dauerhaft, Resultate bei Aufruf | keine Memory-Funktion | nach Begrenzung niedrig | behalten |
| `tool-output-guard` | `tool_result` für `subagent` | begrenzt Parent-Resultat ausgewogen | Paketdefekt bei `maxOutput` | niedrig | behalten, nur erlaubte Tool-ID |
| `git-header` | `session_start`, Header | kein Modellkontext | unter Agent-Layout überschrieben; mehrere Git-Prozesse ohne sichtbaren Nutzen | funktional mittel, Kontext niedrig | deaktiviert, Datei für Rückbau behalten |
| `pi-zentui` | Editor, User-Chrome und dreigeteilter Footer | keine Compaction-Manipulation | alleiniger globaler Footer-/Editor-Eigentümer | niedrig | Standard-/Cockpit-Layout behalten |
| `pi-tool-display` | Built-in-Renderer | nur Darstellung | keine kanonische Kürzung | niedrig | behalten |
| `pi-subagents` | Child-Sessions, Fresh/Fork, Resultate | kompakte Toolbeschreibung und finale Antwort | Paket-Skill, Output-Limit | nach Guard mittel | gepinnt behalten |
| Catppuccin | Theme | keine | keine | niedrig | behalten |

Es gibt keine parallele Compaction- oder Memory-Extension. Für normale
Subagent-Aufrufe ist nur der lokale Result-Guard aktiv; der Paket-Truncator
würde erst durch einen expliziten programmgesteuerten `maxOutput`-Wert aktiv.

### UI-Folgeaudit vom 16. Juli 2026

- `pi-droid-styling` am gepinnten Commit
  `14d320ee5aaddaf55277a53c179c846887988315` wurde nicht installiert. Es
  registriert sieben Built-in-Tools neu, kann `edit` an `pi-ctx-kit` koppeln,
  patcht private Prototypen nicht vollständig rückbaubar und wurde gegen Pi
  0.78 statt die aktive Runtime 0.80.7 entwickelt.
- `@odradekk/vera-theme@0.4.0` wurde nur isoliert unter `/tmp` geprüft. Ein
  globaler Einsatz wurde verworfen, weil ungeprüfte Projektkonfiguration
  `builtinChrome`/`hashline` aktivieren kann und `builtinChrome` die
  `read`-Semantik verändert. Der veröffentlichte Smoke-Test ist außerdem ohne
  einen nicht mitgelieferten Monorepo-Helfer nicht ausführbar.
- Statt eines riskanten Full-UI-Pakets nutzt der aktive Stack die vorhandenen,
  gepinnten Eigentümer stärker: Zentui rendert Editor, User-Chrome und einen
  dreigeteilten Cockpit-Footer; `pi-tool-display` bleibt alleiniger
  Built-in-Renderer. Es wurde kein neues Paket installiert.

## Umgesetzte Änderungen

1. Funktionierende, hash-verifizierte Sicherung mit Pfadmanifest erstellt.
2. Globale Regeln entschlackt und Pi-Projektkarte im Elternpfad eingeführt.
3. Persistenten Projektstatus und bedarfsgesteuerten Checkpoint-Skill erstellt.
4. Session-, Compaction-, Subagenten- und Tool-Ausgabe-Architektur dokumentiert.
5. Versteckte alte Plan-Modus-Nachrichten aus dem Provider-Kontext entfernt.
6. LSP- und Subagenten-Ausgaben auf ca. 50 KiB/2.000 Zeilen begrenzt.
7. Subagenten-Toolbeschreibung komprimiert und alle Profile explizit auf
   Fresh-Chat, schlanken Projektkontext und keinen Skill-Import gesetzt.
8. Runtime-/Dev-Versionsabweichung korrigiert dokumentiert.
9. Zentui vom reduzierten Agent-Layout auf ein informationsreiches
   Standard-/Cockpit-Layout mit Git, Kontext-Gauge, Tokens und Kosten
   umgestellt.
10. `git-header` deaktiviert und Hidden-Thinking-/Working-Indikator-Eigentum
    zwischen `thinking-view` und `activity-status` eindeutig getrennt.

## Verifikationsergebnis

- Sicherung: 20 bestehende Dateien lesbar und SHA-256-identisch kopiert.
- Neustart/Ressourcen: Pi-RPC startete ohne Extensionfehler; exakt globale
  Regeln, leere Eltern-`CLAUDE.md` und Pi-Projektkarte wurden gefunden.
- Skill: 11 Skills, keine Diagnostics; normaler Prompt enthält nur Metadaten.
  `/skill:context-checkpoint` expandierte den 1.989-Zeichen-Body einschließlich
  Compaction-Guardrail erst beim Aufruf. Der anschließende No-Tools-Modellturn
  endete providerseitig mit `finish_reason: error`; das dabei erzeugte
  sachfremde Testplan-Artefakt wurde vollständig entfernt.
- Modell: Der ursprüngliche Live-Test über `tencent/hy3:free` und ein finaler
  Live-Test über das neue `cohere/north-mini-code:free` antworteten korrekt.
  Pi meldet für den Endzustand 256.000 Kontext- und 64.000 Ausgabetokens;
  Auto-Compaction ist aktiv.
- Session: Ein isolierter CLI-Fork in `/tmp` erhielt die Ursprungsantwort,
  schrieb eine eigene Folgeantwort und ließ die Ursprungsdatei erhalten.
- Compaction: Private Kopie einer vorhandenen langen Session; 76.473 Tokens
  vor und 14.603 geschätzt danach. Alle zehn geforderten Fokusüberschriften
  waren vorhanden; Sessioninhalte wurden nicht in den Report übernommen.
- Subagent: Echter `scout` mit `context: fresh`; Parent-Sentinel weder im
  delegierten Task noch im 611-Byte-Resultat. Alle sechs Ergebnisabschnitte
  vorhanden, kein Transcript im Parent-ToolResult.
- TypeScript, JSON, Skill-Validator und `git diff --check`: bestanden.
- Vorgeschriebenes `npm --prefix npm run verify`: 356 bestanden, 26
  fehlgeschlagen. Alle 26 betreffen die bereits bestehende Fake-LSP-
  Serverstream-Baseline; die neuen Kontexttests bestehen.
- UI-Folgeprüfung: JSON gültig; die aktualisierten Eigentümer-, Footer- und
  Activity-Regressionsprüfungen bestehen innerhalb derselben Baseline. Vera
  startete nur im isolierten `/tmp`-Agent erfolgreich; Pi Droid und Vera wurden
  nach Quellcodeaudit nicht global aktiviert. Der aktive Stack startete und
  lud per `/reload` bei 80 Spalten sowie in einem separaten 120-Spalten-Test
  ohne Extensionfehler; die schmale Ansicht behielt Kontext und Fehlerstatus.

## Bewusst nicht umgesetzt

- Keine agentenseitig erzwungene Modell- oder Providerumstellung; die parallele
  Nutzerumstellung wurde lediglich erhalten und verifiziert.
- Keine Änderung an Compaction-Werten ohne Verlustbeleg.
- Keine externe Memory-, Smart-Compaction- oder Context-Extension: kein
  verbleibender Nutzen, der Komplexität und Überschneidung rechtfertigt.
- Keine Entfernung der leeren Eltern-`CLAUDE.md`, historischer Sessions,
  Prompt-Templates oder Paket-Artefakte.
- Keine externe Full-UI-Extension: Pi Droid und Vera verletzen unverändert die
  festgelegte Presentation-only-/Trust-Grenze. Ein eigener Wartungsfork wäre
  für eine kosmetische Verbesserung unverhältnismäßig.
- Keine Angleichung von Runtime 0.80.7 und Dev-Pin 0.80.6 ohne separates
  Paketupdate und vollständige Kompatibilitätsprüfung.

## Verbleibende Risiken und Priorität

1. **Mittel:** `xhigh: 100000` liegt über dem registrierten 64K-Ausgaberahmen
   des neuen Standardmodells; tatsächliches Clamping/Overflow beobachten,
   bevor der Wert geändert wird.
2. **Mittel:** Runtime-/Dev-Versionsabweichung kann interne API-Tests vom
   produktiven Verhalten abweichen lassen.
3. **Mittel:** Die bestehende Fake-LSP-Testumgebung beendet Serverstreams und
   hält den vollständigen Verify-Lauf mit 26 Fehlern rot; neue Fehler müssen
   gegen diese Baseline bewertet werden.
4. **Niedrig:** Session- und Subagenten-Artefakte wachsen weiter und sollten
   periodisch hinsichtlich Aufbewahrung, nicht als Modellmemory, geprüft werden.
