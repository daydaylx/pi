# Seltene Agent-Abläufe

Die globalen Vorgaben stehen in `AGENTS.md`. Diese Referenz enthält Abläufe,
die nur bei bestimmten Aufgaben relevant sind. Die technischen Grenzen in
Extensions und Policies bleiben maßgeblich.

## Recherche und Dateiarbeit

- Suche Code und Dateien gezielt mit `rg` bzw. den verfügbaren Suchwerkzeugen.
  Lies nur den relevanten Bereich und bestätige Pfade, bevor du sie änderst.
- Lies den Zielbereich unmittelbar vor einer Änderung frisch. Nach einem
  fehlgeschlagenen Read, Pfadzugriff oder Patch-Kontext lies den tatsächlichen
  Zustand neu, statt den Versuch blind zu variieren.
- Teile größere Änderungen in kleine Schritte. Führe zuerst den engsten
  betroffenen Test aus. Starte Tests im Paketverzeichnis, das CI verwendet.
- Weise vorbestehende Fehler nur mit einer belegten Ausgangsbaseline als
  solche aus.
- Begrenze Logs und große JSON-Ausgaben. Vor vollständigen Diffs zuerst
  `git diff --stat`, dann nur die betroffenen Dateien lesen. Markiere sichtbar,
  wenn eine Ausgabe gekürzt ist.
- Pi: `!!command` nur verwenden, wenn die Nutzerin oder der Nutzer die Ausgabe
  sehen soll, der Agent sie aber nicht weiter auswerten muss.
- Eine Sperre nicht mit einem anderen Schreibweg umgehen. Wird derselbe
  Tool-Aufruf dreimal hintereinander mit identischen Argumenten und demselben Blockgrund
  abgelehnt, beendet der Guard den wiederholten Tool-Lauf; behebe den
  Blockgrund oder nutze die genannte Alternative.
- Endete der vorherige Lauf, bevor mutierende Aufrufe bestätigt waren (Fehler,
  Abbruch, Aufruf ohne Ergebnis), bekommt der nächste Lauf einen versteckten
  Hinweis mit diesen Aufrufen und `git status --short` (ADR 041). Aufrufe ohne
  Ergebnis gelten als möglicherweise ausgeführt: Zustand prüfen, bevor sie
  wiederholt werden. Es gibt keine Schreibsperre und kein Prüfwerkzeug dafür.

## Verifikation

- Pi: Das deklarierte Pflichtprofil wird für den Abschluss mit
  `project_check({ profile: "verify" })` ausgeführt. Nur dieser Aufruf
  aktualisiert Verifikations-Footer und -Ledger. Ein direkter Lauf von
  `npm run verify` dient dem Debugging und ersetzt ihn nicht. Das Pi-Setup-Tool
  `verify` prüft ausschließlich `~/.pi/agent`.
- Kleine, lokale Änderung: gezielter Test und passende Syntax-/Typprüfung; kein
  globales Verify ohne Anlass. Bei Verträgen, Sicherheits-/Permission-Grenzen
  oder mehreren Subsystemen die relevante Suite und betroffene
  Subsystem-Prüfungen verwenden.
- Einen vollständigen Testlauf nicht ohne Änderung am geprüften Stand
  wiederholen. Nach dem gezielten Test nur noch fehlende Pflichtnachweise
  ergänzen.
- Ein Verifier-Ergebnis `FAIL`, `INCOMPLETE` oder `UNVERIFIABLE` bleibt ein
  Befund. Vor Commit oder Push beheben und erneut prüfen oder den offenen Punkt
  ausdrücklich benennen.
- Profile, Trust-Gates und Statusbedeutungen stehen in
  `docs/verify-profiles.md`; Verifier-Need-Gate und Übergabevertrag in
  `docs/subagents.md`.

## Zusätzliche Projektwurzeln in einer Sitzung

Für ein weiteres Projekt `workspace_add({ path })` aufrufen. Pi zeigt den
aufzulösenden Projektpfad in einem UI-Bestätigungsdialog; die Freigabe gilt bis
zum Ende dieser Sitzung und wird bei einem Resume derselben Session aus der
Session-Historie wiederhergestellt. In Modi ohne interaktive UI wird der
Aufruf abgelehnt. Bei einem Git-Projekt gilt dessen Git-Toplevel, bei einem
Verzeichnis ohne Git die ausdrücklich angegebene Verzeichniswurzel.

Die freigegebene Wurzel erweitert den Datei-Scope und kann für
`project_check({ profile, workspaceRoot })` verwendet werden. Die vorhandene
Berechtigungsstufe sowie Secret- und Symlink-Grenzen gelten weiter. Die Shell behält ihre bestehende Bash-Klassifikation und ihr
Ausführungs-`cwd`; für dateibezogene Arbeit in zusätzlichen Wurzeln die
Datei-Tools oder `project_check` mit `workspaceRoot` verwenden.

Prüfstände (`project_check`) sind pro freigegebener Wurzel getrennt.

## Git-Veröffentlichung

Commits und Pushes brauchen keine Einzelfreigabe: nach jedem abgeschlossenen
Teilschritt sofort in kleinen, thematisch getrennten Commits festhalten und
direkt pushen. Nur eigene Dateien gezielt stagen (nie `git add -A`), Änderungen
anderer Sitzungen nicht mitcommitten. Force-Push und das Umschreiben gepushter
Commits sind ausgeschlossen; Merge, Branch-Veröffentlichung und Deployment nur
auf ausdrücklichen Auftrag. Commit und Push
sind getrennte Schritte. Vor einem Commit mit verifier-pflichtigem Diff muss
der erforderliche Verifier-Nachweis für denselben Workspace-Fingerprint
vorliegen. Nach einem Push-Fehler lokalen Commit- und Upstream-Status prüfen;
höchstens einen gezielten Retry durchführen.

## Webrecherche

Websuche nur, wenn Aktualität, externe Dokumentation oder ein lokal nicht
prüfbares Verhalten sie erfordert. Zuerst gezielt suchen, danach nur relevante
HTTP(S)-Quellen öffnen. Keine lokalen Pfade, Auth-Daten oder Repository-Klones
an Fetch-Werkzeuge übergeben. Lokale Repository-Fragen zuerst lokal klären.

## Sitzungsfortsetzung

Für bewusste Checkpoints und die Pflege von `docs/PROJECT_STATE.md` sowie
`docs/CONTEXT_LEDGER.md` ausschließlich den Skill `context-checkpoint`
verwenden. Keine automatische Projektdatei pro Compaction erzeugen.

## Verhaltensvergleich für P2

Die folgenden typischen Aufgaben wurden regelweise gegen die vorherige
globale Fassung verglichen. „Ergebnis“ nennt die erwartete Verhaltensparität,
nicht einen automatisierten Modell-Eval.

| Typische Aufgabe                                   | Vorher                                                              | Jetzt                                                                                      | Ergebnis                                              |
| -------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| Tippfehler in einer Dokumentation                  | FAST-Grenzen und Stop-Regel direkt in `AGENTS.md`                   | Regel „engster passender Check“ und Stop-Regel in `AGENTS.md`; Klassen entfallen (ADR 039) | gezielter Check bleibt erhalten                       |
| Kleine TUI-Textänderung                            | TUI/Bridge-Ausschluss direkt in `AGENTS.md`                         | Globaler Scope-Hinweis mit Verweis auf `docs/scope-cli-tui-vs-gui.md`                      | Bridge bleibt bei TUI-Auftrag außen vor               |
| Lokaler Bugfix mit Regressionstest                 | kleine Schritte und Baseline-Regel in `AGENTS.md`                   | dieselben Regeln in `docs/agent-workflow.md`                                               | zuerst engster Test; keine unbelegte Baseline         |
| Permission-Änderung                                | Hard-Pfade und Verifier-Gate ausführlich global                     | globale Schutzregel plus `docs/subagents.md` und technische Policy                         | kein Risiko durch Dokumentenverschiebung freigegeben  |
| Öffentliche API-/IPC-Änderung                      | Need-Gate/Verifier-Trigger global erklärt                           | globaler Boundary-Hinweis plus `docs/subagents.md`                                         | Hard-Pfad und Need-Gate bleiben maßgeblich            |
| Commit und Push                                    | expliziter Auftrag und Verifier-Regeln global                       | Commit-/Push-Regel global, Ablauf in Workflow-Referenz                                     | kleine Commits, direkt gepusht; Schritte getrennt     |
| Aktuelle externe Provider- oder API-Frage          | Bedingung, Such-/Fetch-Reihenfolge global                           | kurze globale Bedingung, Ablauf in Workflow-Referenz                                       | lokale Fragen bleiben lokal; externe Quellen gezielt  |
| Lange Sitzung oder Compaction                      | Checkpoint-Regel global, Skillbeschreibung nannte auch jede Analyse | seltene Auslöser im Skill; globaler Verweis                                                | kein Routine-Checkpoint und kein automatisches Ledger |
| Unbekannter Bug mit möglicher unabhängiger Analyse | Delegationskriterien und Limits global                              | globaler Nicht-Rollen-Hinweis plus `docs/subagents.md`                                     | temporäre Delegation nach Nutzen und Grenzen          |

Diese Matrix ist eine Verhaltensprüfung, kein zusätzlicher Workflow und keine
Ausnahme von Nutzeranweisungen.

### Umfangsmessung

| Text                                  |                                       Vorher |                                  Nachher |
| ------------------------------------- | -------------------------------------------: | ---------------------------------------: |
| `AGENTS.md`                           | 265 Zeilen, 16.103 UTF-8-Bytes, 1.826 Wörter | 34 Zeilen, 4.533 UTF-8-Bytes, 481 Wörter |
| Beschreibung von `context-checkpoint` |                              340 UTF-8-Bytes |                          251 UTF-8-Bytes |

Damit sinkt `AGENTS.md` um 71,9 % Bytes und 73,7 % Wörter; die Skill-
Beschreibung um 26,2 % Bytes. Als reproduzierbare Token-Näherung gilt
`ceil(UTF-8-Bytes / 4)`: etwa 4.026 auf 1.134 Tokens für `AGENTS.md` und 85
auf 63 für die Skill-Beschreibung. Das ist kein modellgenauer Tokenizer.

Die übrigen elf Skill-Beschreibungen wurden geprüft und blieben unverändert:
ihre Aktivierung ist auf die jeweilige Aufgabe beschränkt und sie versprechen
keine zusätzlichen Rechte.
