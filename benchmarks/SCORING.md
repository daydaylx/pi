# Messgrößen

Für jede Messgröße: Definition, Erfassungsmethode, Datenquelle. Siehe
`harness/collect-metrics.mjs` für die technische Umsetzung der automatischen
Anteile und `harness/schema/run-result.schema.json` für das Ausgabeformat.

| #   | Messgröße                              | Definition                                                                                                                                                                | Methode                                                                                                                                | Datenquelle                                                            |
| --- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 1   | Erfolgreiche Lösung ohne Nachkorrektur | Aufgabe gilt beim ersten Agentenlauf als vollständig und korrekt gelöst, ohne dass der Auftraggeber während oder nach dem Lauf eingreifen musste                          | halbautomatisch: `verify`-Exit-Code (automatisch) + Abgleich mit "Erwartetes Ergebnis" der Task-Spezifikation (manuell)                | `harness/run-verify.sh` + manuelle Prüfung gegen `TASK.md`             |
| 2   | Benötigte Nutzerkorrekturen            | Anzahl zusätzlicher User-Turns nach dem ersten Agent-Ende, die eine Korrektur/Nachbesserung anfordern                                                                     | automatisch zählbar: Anzahl `message`-Einträge mit `role:"user"` nach dem ersten `agent_end`/`agent_settled`                           | Session-JSONL                                                          |
| 3   | Unnötig geänderte Dateien              | Dateien im finalen Diff außerhalb des in `TASK.md` erlaubten Änderungsumfangs                                                                                             | automatisch: `git diff --numstat` gegen die Allowlist aus `TASK.md`                                                                    | `git diff` im Worktree (`harness/collect-metrics.mjs --allowed-files`) |
| 4   | Unnötig geänderte Zeilen               | Summe hinzugefügter+entfernter Zeilen außerhalb des erlaubten Umfangs, plus Zeilen innerhalb erlaubter Dateien, die nicht zur Kernänderung gehören (z. B. Reformatierung) | teilautomatisch: Rohzahl je Datei automatisch; Abgrenzung "gehört zur Kernänderung" manuell                                            | `git diff` + manuelle Durchsicht                                       |
| 5   | Fehlgeschlagene Tool-Aufrufe           | Anzahl `toolResult`-Einträge mit `isError:true`                                                                                                                           | vollautomatisch                                                                                                                        | Session-JSONL                                                          |
| 6   | Test-/Build-Ergebnis                   | Exit-Code von `npm run verify`, kompensiert um die bekannte Baseline aus `harness/BASELINE.md`                                                                            | vollautomatisch                                                                                                                        | `harness/run-verify.sh`                                                |
| 7   | Tokenverbrauch                         | Summe `usage.totalTokens` (bzw. `input`+`output`+`reasoning`) über alle Assistant-Messages, getrennt nach Haupt-Session und delegierten Subagent-Sessions                 | vollautomatisch                                                                                                                        | Session-JSONL `usage`-Feld je `message`-Eintrag mit `role:"assistant"` |
| 8   | Laufzeit                               | Wall-Clock-Zeit vom ersten bis letzten Zeitstempel der Sitzung; bei Subagenten zusätzlich `duration` aus `run-history.jsonl`                                              | vollautomatisch                                                                                                                        | Zeitstempel in Session-JSONL, `run-history.jsonl`                      |
| 9   | Modellaufrufe                          | Anzahl Assistant-Turns (= Anzahl `message`-Einträge mit `role:"assistant"`)                                                                                               | vollautomatisch                                                                                                                        | Session-JSONL                                                          |
| 10  | Subagentenaufrufe                      | Anzahl Einträge in `run-history.jsonl` mit Timestamp innerhalb des Laufzeitfensters der Aufgabe                                                                           | vollautomatisch (Zeitfenster-Filter über `--window-start`/`--window-end`)                                                              | `run-history.jsonl`                                                    |
| 11  | Verlorene Anforderungen                | Teile des ursprünglichen Auftrags (insbesondere bei Mehrfach-Etappen-Aufgaben wie #08), die im finalen Ergebnis fehlen oder widersprüchlich behandelt wurden              | manuell/subjektiv: Checkliste aus den Teilanforderungen in `TASK.md` gegen finales Diff+Antwort abhaken                                | manuelle Prüfung                                                       |
| 12  | Wiederholte identische Fehler          | Anzahl Fälle, in denen derselbe `toolName` mit strukturell identischen Argumenten nach einem vorherigen `isError:true`-Ergebnis erneut aufgerufen wird                    | teilautomatisch: exakte Wiederholung (Tool+Argumente identisch) automatisch zählbar; Beurteilung "ohne geänderten Kontext" ist manuell | Session-JSONL `toolResult`/`toolCall`-Paare                            |
| 13  | Entscheidungs-Persistenz nach Compaction | Sind bestätigte Nutzerentscheidungen, Nicht-Ziele und Architekturentscheidungen nach dem Lauf (potenziell nach einer Compaction) im finalen Turn UND in `docs/CONTEXT_LEDGER.md` unverändert und widerspruchsfrei vorhanden? | teilautomatisch: Datei-Abgleich der erwarteten Fakten gegen den Ledger automatisch (`--ledger-expects`, Feld `automatic.ledgerSurvival`); inhaltliche Widerspruchsfreiheit manuell (`manualAssessment.decisionPersistenceAfterCompaction`) | `docs/CONTEXT_LEDGER.md` im Worktree + finaler Assistant-Turn |
| 14  | Projektstatus-Korrektheit | Stimmt der berichtete Stand (offene vs. erledigte Todos) im Abschluss-Turn mit Plan/Progress überein? | manuell: Abschluss-Turn gegen `.agent/plans/current-plan.md`/Progress abgleichen (`manualAssessment.projectStatusCorrectness`) | finaler Assistant-Turn + Plan-Datei |
| 15  | Halluzinationsrate nach langer Sitzung | Anzahl behaupteter Entscheidungen/Fakten im Abschluss-Turn, die weder im Ledger noch im Decision Brief noch im Plan belegt sind | teilautomatisch/manuell: unbelegte Behauptungen markieren und zählen (`manualAssessment.hallucinationCount`) | finaler Assistant-Turn + Ledger/Brief/Plan |

## Automatisch vs. subjektiv

| Automatisch (Harness)                                                                                                                                                                       | Manuell/subjektiv                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fehlgeschlagene Tool-Aufrufe, Test-/Build-Ergebnis, Tokenverbrauch, Laufzeit, Modellaufrufe, Subagentenaufrufe, Nutzerkorrekturen (Zählung), unnötig geänderte Dateien (Allowlist-Abgleich) | Erfolgreiche Lösung ohne Nachkorrektur (inhaltliche Korrektheit), unnötig geänderte Zeilen (Kernänderung vs. Beiwerk), verlorene Anforderungen, Qualität der Code-Lösung jenseits der Tests (Lesbarkeit, Stilkonsistenz), Abgrenzung "wiederholter identischer Fehler ohne Kontextänderung" |

`harness/collect-metrics.mjs` schreibt die automatischen Messgrößen in das
Feld `automatic` von `run-result.json`. Das Feld `manualAssessment` enthält
ausschließlich `null`-Platzhalter, die von einem Menschen ausgefüllt werden
müssen — nie automatisch geraten oder mit einem Default befüllt.

Für Messgröße 13 erhebt der Harness einen automatischen Teil: mit
`--ledger-expects "<Fakt A>|<Fakt B>|…"` prüft `collect-metrics.mjs`, ob die als
dauerhaft erwarteten Fakten nach dem Lauf in `docs/CONTEXT_LEDGER.md` vorhanden
sind (Feld `automatic.ledgerSurvival` mit `present`/`missing`). Die inhaltliche
Widerspruchsfreiheit im finalen Turn sowie die Messgrößen 14 und 15 bleiben
manuell.

## Bekannte Grenzen der Automatisierung

- **Baseline-Kompensation** (siehe `harness/BASELINE.md`): Referenzcommit
  `7b886a3` hat 5 bekannte, vom Agenten unabhängige Testfehlschläge, sobald
  `verify` außerhalb von `/home/d/.pi/agent` läuft. `collect-metrics.mjs`
  rechnet diese heraus (`verify.likelyCausedByAgent`), statt sie fälschlich
  dem Agentenlauf zuzuschreiben.
- **Subagent-Isolation**: Delegierte Subagenten schreiben eigene
  Session-Dateien; die Zuordnung zur Hauptaufgabe erfolgt über ein
  Zeitfenster (`--window-start`/`--window-end`), nicht über eine harte
  ID-Verknüpfung — `run-history.jsonl` bietet keine direkte Aufgaben-ID.
- **Aufgabe 05 ist testarm**: Auch mit dem breiteren
  `fixture/run-fixture-test.mjs` beweist "alle Tests grün" keine vollständige
  Verhaltenstreue eines Refactorings — manuelle Code-Review bleibt
  zwingender Teil der Bewertung.
- **Kein automatisches Ranking**: Dieses Konzept liefert Rohmesswerte pro
  Lauf, keine Gesamt-Score-Formel und keinen automatischen Vergleich
  "Konfiguration A besser als B". Das ist eine bewusste Nicht-Ziel-Vorgabe,
  keine technische Lücke.
