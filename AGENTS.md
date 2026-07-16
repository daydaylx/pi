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
- Dauerregeln in `AGENTS.md`, ausführliche Referenz in `docs/` und aktuellen Arbeitsstand in `docs/PROJECT_STATE.md` trennen.

## Sessions und Arbeitsstand

- Bei Wechsel des Hauptziels oder Projekts eine neue Session verwenden.
- Bei langen zusammenhängenden Aufgaben vor Compaction, Modellwechsel oder Sessionwechsel einen kompakten Context-Checkpoint erstellen.
- `/fork` für Alternativen, `/clone` für eine separate Zweigkopie, `/tree` für Navigation innerhalb einer Session und `/compact` für lange weiterhin zusammenhängende Aufgaben verwenden.

## Subagenten

- Der Haupt-Agent delegiert klar abgrenzbare, unabhängige oder spezialisierte Teilaufgaben eigenständig; triviale Kleinstaufgaben bleiben lokal.
- Unabhängige Aufgaben starten standardmäßig mit frischer Unterhaltung. Fork-Kontext nur nutzen, wenn frühere Nutzerentscheidungen tatsächlich benötigt werden.
- Ergebnisse kompakt synthetisieren und Belege, betroffene Dateien, Risiken, offene Fragen und Empfehlung nennen; keine vollständigen Unterhaltungen zurückkopieren.
- Profilauswahl und Detailregeln nur bei Bedarf aus `/home/d/.pi/agent/docs/subagents.md` lesen.
