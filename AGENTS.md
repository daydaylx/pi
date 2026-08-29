# Globale Agent-Regeln

Diese Datei trägt nur Regeln, die in fast jeder Sitzung gelten. Seltene
Ablaufregeln stehen in der jeweils zuständigen Datei: Sitzungs- und
Checkpoint-Ablauf im Skill `context-checkpoint`, Subagenten-Details in
`docs/subagents.md`, Verifikationsprofile in `docs/verify-profiles.md`.

## Schutzregeln

- Änderungen auf den konkreten Auftrag begrenzen; keine breiten Refactorings,
  Umbenennungen oder Formatierungen ohne Auftrag.
- Bestehende, nicht zum Auftrag gehörende Nutzeränderungen erhalten.
- Secrets, Zugangsdaten, Auth-Dateien, Umgebungsvariablen und SSH-Schlüssel
  weder offenlegen noch in Reports oder Versionskontrolle übernehmen.
- Projektabhängigkeiten oder Systempakete nur nach vorheriger Zustimmung
  hinzufügen oder installieren.
- Vor einem Shell-Aufruf prüfen, ob er außerhalb des Projektpfads schreibt,
  unquotierte Variablen verwendet oder Secret-/Credential-Grenzen berührt.
  Nach einer Schutzgrenzen-Blockierung nicht dieselbe Strategie variieren,
  sondern die Ursache bestimmen und eine zulässige projektlokale Alternative
  wählen.
- Den aktiven Workflow- und Permission-Modus respektieren. Diese Datei
  erzwingt keinen zusätzlichen Planmodus.

## Verifikation

- Änderungen mit den relevanten Tests und statischen Prüfungen verifizieren;
  Fehler und nicht ausführbare Prüfungen ausdrücklich nennen.
- `project_check({ profile: "verify" })` ist der kanonische Weg für das
  deklarierte Pflichtprofil — nur dieser Tool-Aufruf aktualisiert
  Verifikations-Footer und -Ledger. Ein direkter `bash`-Lauf von
  `npm run verify` bleibt zum Debuggen einzelner Schritte möglich, zählt aber
  nicht als durchgeführte Verifikation (`docs/verify-profiles.md`). Rohe
  Interpreteraufrufe (`node`, `python`) über `bash` können je nach
  Berechtigungsstufe blockiert werden.
- Einen Teilauftrag erst als umgesetzt bezeichnen, wenn der zugehörige
  Testlauf beendet und sein Ergebnis dokumentiert ist. Vor dem finalen
  Abschluss zusätzlich `project_check({ profile: "verify" })` ausführen.
- Ein `FAIL`- oder `UNVERIFIABLE`-Urteil sowie ein ergebnisloser
  `verifier`-Lauf vor Commit oder Push nicht unkommentiert lassen: entweder
  beheben und erneut prüfen, oder den offenen Punkt dem Nutzer ausdrücklich
  nennen.

## Commit und Push

- Commits, Pushes und Branch-Veröffentlichungen nur auf ausdrücklichen
  Auftrag ausführen.
- Commit und Push als getrennte Schritte ausführen. Nach einem Push-Fehler den
  lokalen Commit- und Upstream-Status berichten und höchstens einen gezielten
  Retry durchführen.

## Kontextdisziplin

- Zuerst gezielt suchen und nur relevante Dateien oder Ausschnitte lesen. Für
  Code- und Dateisuche die eigenständigen `grep`- und `find`-Tools verwenden
  statt `bash rg`/`git grep`/`find` — sie sind vom Plan-Modus-Gate nicht
  betroffen (das greift nur bei `bash`/`write`/`edit`) und liefern
  strukturierte Treffer statt geratener Pfade.
- Vor der ersten Änderung Arbeitsauftrag, betroffene Implementierung und
  zugehörige Tests gezielt lokalisieren; keine Pfade oder Patch-Kontexte
  raten. Nach zwei fehlgeschlagenen Lese-, Pfad- oder Editversuchen den
  tatsächlichen Kontext erneut lesen.
- Änderungen in kleinen, testbaren Schritten vornehmen und nach jedem
  Teilpaket zuerst den engsten betroffenen Test ausführen. Vorbestehende
  Fehler nur mit einer belegten Ausgangsbaseline als solche ausweisen.
- Große Logs mit Filtern, `head`, `tail` oder Suchmustern begrenzen; große
  JSON-Daten vor dem Lesen filtern. Vor vollständigen Diffs
  `git diff --stat` verwenden und Diffs anschließend dateibezogen lesen.
  Testergebnisse auf Zusammenfassung und relevante Fehlerstellen beschränken.
- Einen vollständigen Testlauf nicht ohne Änderung des geprüften Stands
  wiederholen. Nach einem gezielten Test stattdessen nur den noch fehlenden
  kanonischen `project_check`-Nachweis ausführen.
- Gekürzte Ausgaben sichtbar kennzeichnen. `!!command` nur verwenden, wenn der
  Nutzer die Ausgabe sehen soll, das Modell sie aber nicht weiter benötigt.
- Dauerregeln in `AGENTS.md`, ausführliche Referenz in `docs/`, dauerhaftes
  Projektgedächtnis in `docs/CONTEXT_LEDGER.md` und flüchtigen Arbeitsstand in
  `docs/PROJECT_STATE.md` trennen; dauerhafte Fakten nicht duplizieren. Beide
  Dateien werden ausschließlich über den Skill `context-checkpoint` gepflegt;
  dort stehen auch die Regeln für Checkpoints, Providerfehler und
  Sitzungswechsel.

## Scope: CLI/TUI vs. GUI

Zwei unabhängige Oberflächen: CLI/TUI (Aurora-Terminal-UI) und GUI
(Electron-Desktop „pi gui"). Nennt der Auftrag eindeutig die eine Seite, nur
deren Pfade lesen; die andere Seite bleibt außen vor, außer der Auftrag
nennt ausdrücklich die Bridge/den Contract oder beide Seiten. Vollständige
Pfadzuordnung: `docs/scope-cli-tui-vs-gui.md`. Achtung:
`extensions/aurora-ui/` gehört trotz des Namens zur CLI/TUI, nicht zur GUI.

## Webtools (`web_search` / `fetch_content`)

- `web_search` nur bei echtem Aktualitätsbedarf: aktuelle Library-/Framework-Versionen, externe API-Doku, unbekannte aktuelle Fehlermeldungen, Provider-/Tool-Verhalten, das lokal nicht prüfbar ist — und nur wenn lokale Repository-Evidenz nicht reicht. Nie „vorsichtshalber“; was im Repo steht oder per `grep`/`find`/`read`/LSP/Investigator beantwortbar ist, bleibt lokal.
- Standardablauf: erst `web_search`, dann gezielt die relevanten Quellen mit `fetch_content` öffnen; `includeContent` standardmäßig nicht setzen, nur bei konkretem begründetem Bedarf; keine breitflächigen Fetch-Ketten.
- `fetch_content` nur mit konkreter, relevanter http(s)-URL (Doku-Seiten, PDFs, GitHub-Webseiten als normale HTTP-Quellen) — nie für lokale Pfade, nie mit `auth`, kein Repo-Clone über die Extension (GitHub-Cloning ist deaktiviert); Repos bleiben beim bestehenden Git-/Investigator-Workflow.
- Investigator/Subagenten arbeiten rein lokal; keine automatische Kopplung an Websuche.

## Subagenten

### Harte Kriterien

Ein Subagent wird nur verwendet, wenn mindestens eine Bedingung erfüllt ist:

1. Die Teilaufgabe ist klar unabhängig.
2. Ein anderes Toolset oder Berechtigungsprofil wird benötigt.
3. Eine unabhängige Prüfung erzeugt echten Mehrwert.
4. Der relevante Repository-Bereich ist noch unbekannt.
5. Die Entscheidung besitzt hohe Folgekosten.

Triviale Teilaufgaben bleiben beim Hauptagenten.

### Delegationsmuster

- **Triviale, klar lokalisierte Aufgabe:** Hauptagent direkt.
- **Unbekannter Repository-Bereich oder unklare Änderungssurface:**
  `investigator` für eine belegte, reine Analyse. Im Simple oder Detailed
  Plan ist nur diese synchrone read-only SINGLE-Delegation zulässig; bei
  bekanntem lokalen Pfad bleibt der Hauptagent zuständig.
- **Unbekannter, intermittierender oder gescheiterter Bug:** `debugger` für
  Reproduktion und Hypothesentests.
- **Unabhängige Prüfung nach einer riskanten Umsetzung:** `verifier`.

Der `verifier` ist verpflichtend, wenn die Änderung mindestens einen dieser
Risikofaktoren berührt:

- Sicherheitsverhalten,
- Permission- oder Plan-Mode-Logik,
- Workflow- oder Activity-State-Logik,
- öffentliche API oder Schema,
- Installations- oder Upgrade-Verhalten,
- Verifikations- oder Completion-Logik,
- hoher Blast-Radius (geteilter oder kritischer Code, breite Regressionsfläche),
- eine ausdrückliche Nutzeranforderung.

Der `verifier` ist optional — nach eigener Einschätzung — bei mehreren
betroffenen Dateien ohne einen dieser Risikofaktoren, reinen
Dokumentationsänderungen, lokalen UI-Texten oder Farben, mechanischen und eng
getesteten Änderungen sowie kleinen Konfigurationskorrekturen ohne
Verhaltensänderung. Der bloße Umfang eines Diffs löst keine Pflichtdelegation
aus.

Planung, Umsetzung, Triage und finale Nutzerkommunikation bleiben beim
Hauptagenten. Es gibt keine verschachtelte Delegation.

### Übergabe

Fresh-Context-Subagenten sehen den Parent-Dialog nicht. Das `task`-Feld trägt
deshalb den ursprünglichen Nutzerauftrag wortgetreu, dazu Nicht-Ziele und die
konkrete Teilfrage.

Für den `verifier` wird die vollständige Übergabe technisch erzwungen, nicht
nur empfohlen: Ein Aufruf ohne Ziel, Scope, Diff, Baseline und
Akzeptanzkriterien oder mit einem per Run gesetzten `turnBudget` wird vor dem
Start geblockt. Pflicht sind deshalb die Abschnitte der Vorlage aus
`docs/subagents.md` — insbesondere der zu prüfende Diff-Text selbst (nicht nur
eine Dateiliste) und die vor der ersten Änderung erfasste Workspace-Baseline
samt Content-Fingerprints vorbestehend schmutziger Pfade. Maßgebliches
Zeitlimit ist ausschließlich das großzügige `timeoutMs` aus
`agents/verifier.md`; ein eng geschätztes `turnBudget` ist verboten und wird
abgelehnt.

Ein abgebrochener, zeitüberschrittener oder providerfehlerhafter
`verifier`-Lauf wird als `INCOMPLETE` erfasst und zählt niemals als
unabhängige Verifikation. Ein fachliches `FAIL` ist ein Befund und wird nicht
durch Wiederholung oder Fallback „geheilt“. Fallback-Modelle greifen nur bei
Provider-/Netzwerk-/Auth-Fehlern, nie bei einem `FAIL`-Urteil oder
Turn-Budget-Überschreitung.

Zwei technische Stolpersteine bleiben bestehen: `toolBudget.block` sperrt
Werkzeuge erst nach Überschreiten von `hard`, nicht ab dem ersten Aufruf — für
ein hartes Bash-Verbot taugt es allein nicht; und `block` ist immer ein Array,
auch bei genau einem Tool.

Ergebnisse kompakt synthetisieren und Belege, betroffene Dateien, Risiken,
offene Fragen und Empfehlung nennen; keine vollständigen Unterhaltungen
zurückkopieren.
