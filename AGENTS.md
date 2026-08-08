# Globale Agent-Regeln

Diese Regeln gelten für alle Pi-Sitzungen.

## Schutzregeln

- Commits, Pushes und Branch-Veröffentlichungen nur auf ausdrücklichen Auftrag ausführen.
- Projektabhängigkeiten oder Systempakete nur nach vorheriger Zustimmung hinzufügen oder installieren.
- Änderungen auf den konkreten Auftrag begrenzen; keine breiten Refactorings, Umbenennungen oder Formatierungen ohne Auftrag.
- Bestehende, nicht zum Auftrag gehörende Nutzeränderungen erhalten.
- Secrets, Zugangsdaten, Auth-Dateien, Umgebungsvariablen und SSH-Schlüssel weder offenlegen noch in Reports oder Versionskontrolle übernehmen.
- Änderungen mit relevanten Tests und statischen Prüfungen verifizieren; Fehler und nicht ausführbare Prüfungen ausdrücklich nennen.
- Den aktiven Workflow- und Permission-Modus respektieren. Diese Datei erzwingt keinen zusätzlichen Planmodus.

## Kontextdisziplin

- Zuerst gezielt suchen und nur relevante Dateien oder Ausschnitte lesen.
- Große Logs mit Filtern, `head`, `tail` oder Suchmustern begrenzen; große JSON-Daten vor dem Lesen filtern.
- Vor vollständigen Diffs `git diff --stat` verwenden und Diffs anschließend dateibezogen lesen.
- Testergebnisse auf Zusammenfassung und relevante Fehlerstellen beschränken; keine vollständigen Verzeichnisbäume ohne Grund laden.
- Gekürzte Ausgaben sichtbar kennzeichnen. `!!command` nur verwenden, wenn der Nutzer die Ausgabe sehen soll, das Modell sie aber nicht weiter benötigt.
- Dauerregeln in `AGENTS.md`, ausführliche Referenz in `docs/`, dauerhaftes Projektgedächtnis (Entscheidungen, Nicht-Ziele, Risiken, Regeln) in `docs/CONTEXT_LEDGER.md` und flüchtigen Arbeitsstand in `docs/PROJECT_STATE.md` trennen; dauerhafte Fakten nicht duplizieren.

## Sessions und Arbeitsstand

- Bei Wechsel des Hauptziels oder Projekts eine neue Session verwenden.
- Bei langen zusammenhängenden Aufgaben vor Compaction, Modellwechsel oder Sessionwechsel über den Skill `context-checkpoint` einen kompakten Checkpoint erstellen. Er pflegt bei Bedarf `docs/PROJECT_STATE.md` und `docs/CONTEXT_LEDGER.md`; die Laufzeit konsolidiert diese Dateien nicht automatisch.
- `/fork` für Alternativen, `/clone` für eine separate Zweigkopie, `/tree` für Navigation innerhalb einer Session und `/compact` für lange weiterhin zusammenhängende Aufgaben verwenden.

## Subagenten

### Harte Kriterien

Ein Subagent wird nur verwendet, wenn mindestens eine Bedingung erfüllt ist:

1. Die Teilaufgabe ist klar unabhängig.
2. Ein anderes Toolset oder Berechtigungsprofil wird benötigt.
3. Eine unabhängige Prüfung erzeugt echten Mehrwert.
4. Der relevante Repository-Bereich ist noch unbekannt.
5. Die Entscheidung besitzt hohe Folgekosten.
6. Die Aufgabe kann sinnvoll parallel ausgeführt werden.

Triviale Teilaufgaben bleiben beim Hauptagenten.

### Delegationsmuster

- **Triviale, klar lokalisierte Aufgabe:** Hauptagent direkt.
- **Unbekannter Repository-Bereich oder relevante Änderungssurface:**
  `investigator` für eine belegte, reine Analyse.
- **Unbekannter, intermittierender oder gescheiterter Bug:** `debugger` für
  Reproduktion und Hypothesentests.
- **Unabhängige Prüfung nach nichttrivialer Implementierung:** `verifier`.
  Konkrete Signale für „nichttrivial" (mindestens eines reicht, keine
  Pflichtprüfung): mehrere Dateien oder mehrere Anforderungen/Akzeptanz-
  kriterien betroffen, Regressionsrisiko in geteiltem oder kritischem Code,
  Änderungen an Permission-, Workflow- oder Statuslogik, Änderungen an
  öffentlicher API, Schema oder Konfiguration, hoher Blast-Radius, oder Fälle,
  in denen bestehende Tests allein die Anforderung nicht belegen. Triviale,
  klar lokalisierte Änderungen brauchen weiterhin keinen `verifier`.

Planung, Umsetzung, Triage und finale Nutzerkommunikation bleiben beim
Hauptagenten. Es gibt keine automatische Pflichtdelegation und keine
verschachtelte Delegation.

### Delegationsvorlage

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
```

Das ist Kontextübergabe im vorhandenen `task`-Feld, kein neuer Zustand, keine
ID und keine Persistenz. Die Rollenprofile in `agents/*.md` beschreiben unter
„Eingabe, die du benötigst" dieselbe Struktur aus Empfängersicht.

### Kontext und Ergebnis

- Lokale Profile starten mit frischem Kontext, übernehmen die statischen
  Projektregeln und erben keine Skills. Sie besitzen kein Delegationswerkzeug.
  Fork-Kontext nur nutzen, wenn frühere Nutzerentscheidungen tatsächlich
  benötigt werden.
- Die Laufzeitquellen sind direkt: `settings.json` deaktiviert Paket-Builtins
  mit `subagents.disableBuiltins`; `extensions/subagent/config.json` setzt
  `maxTasks: 4`, `concurrency: 3`, `globalConcurrencyLimit: 3` und
  `maxSubagentSpawnsPerSession: 5`.
- Ergebnisse kompakt synthetisieren und Belege, betroffene Dateien, Risiken, offene Fragen und Empfehlung nennen; keine vollständigen Unterhaltungen zurückkopieren.
- Profilauswahl und Detailregeln nur bei Bedarf aus
  `/home/d/.pi/agent/docs/subagents.md` lesen.
