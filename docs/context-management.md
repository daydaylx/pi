# Context Management

## Begriffe und Datenfluss

Ein Provider-Request besteht aus dem effektiven Systemprompt, den **aktiven** Tool-Schemas und dem compaction-aware Branch der Session. User-, Assistant-, Tool-Result- und Custom-Messages werden vom `SessionManager` persistiert; nach einer Compaction baut `buildSessionContext()` den Branch aus Summary plus jüngstem Kontext neu auf. Persistiert bedeutet daher nicht automatisch, dass ein Eintrag noch an den Provider gesendet wird.

`/setup-doctor context` unterscheidet diese Daten:

- **Active Context Tokens/Percent** stammen aus `ctx.getContextUsage()`, also der Runtime-Ansicht des aktiven Contexts. Nach einer Compaction ohne eine später gültige Assistant-Usage meldet Pi absichtlich keine Zahl; Doctor zeigt dann `pending fresh usage`.
- **Lifetime Usage** ist die Summe persistierter Provider-Usage. Sie enthält historische, kompaktierte Turns und ist weder ein Context-Fenster noch ein Trigger.
- **Cache Read/Write** gehören zur Provider-Usage und werden nur als Teil der Lifetime-Telemetrie gezeigt.
- **Systemprompt- und Tool-Schema-Werte** sind deterministische UTF-8-Bytes, keine vorgetäuschten Tokens. Nur gerade aktive Tool-Schemas zählen.
- **Last Successful Compaction** kommt von persistierten Compaction-Einträgen. Ein letzter Versuch wird nur aus vorhandenen `resilience.compaction-boundary`-Einträgen dargestellt; fehlt er, erfindet Doctor keinen Status.

Die Anzeige enthält außerdem Modell, Context Window, konfigurierten Trigger (`window - reserve`), Reserve, Keep Recent und persistierte Tool-Truncations. Die lokale Konfiguration wird aus Agent- und Projekt-Settings zusammengeführt; sie ist keine Behauptung, dass ein externes Runtime-Override existiert.

## Vorher/Nachher (providerfrei)

| Szenario                            | Vorher                                                                                     | Nachher                                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Normale Session                     | Doctor bezeichnete die kumulierte Session-Usage als `real usage`.                          | Active Context kommt ausschließlich aus der compaction-aware Runtime; Lifetime Usage ist getrennt.           |
| Nach Compaction ohne neue Usage     | Alte Pre-Compaction-Usage blieb die sichtbare Zahl.                                        | `pending fresh usage`; die alte Zahl bleibt nur Lifetime-Telemetrie.                                         |
| Tool-/Subagent-heavy                | Ein großer Subagent-Endbericht konnte als Tool-Content und erneut in Details persistieren. | Parent-Text maximal 12 KiB/240 Zeilen; Details behalten Status und Artefaktreferenzen, nicht den Vollreport. |
| Wiederholte Work-Turns              | Identische Workflow-Custom-Messages wurden persistiert.                                    | Turn-lokaler Systemprompt; keine Workflow-Custom-Message.                                                    |
| 50/70/90 % und Tool-Loop-Compaction | Runtime prüft primär nach `agent_end` bzw. vor einem neuen Prompt.                         | Unverändert bis zum externen Core-Patch; die genaue Patch- und Testanforderung steht unten.                  |

Die Tabelle enthält keine Provider-Kosten: lokale Tests verwenden Fixture-Bytes und synthetische Usage. Native Provider-Usage kann nur ein echter Provider liefern und wird nicht nachgebildet.

## Lokale Begrenzungen

`setup-core` begrenzt den tatsächlichen `tool_result`-Rückgabepfad für `subagent`. Alle Textblöcke eines Parent-sichtbaren Reports teilen sich 12 KiB oder 240 Zeilen; Anfang und Ende sowie ein Kürzungshinweis bleiben erhalten. Nicht-Text-Blöcke, Fehlerflag und Tool-Usage bleiben erhalten. Lauf-ID, Status und vorhandene Artefakt-/Session-/Transkriptpfade bleiben in Details, während doppelte Vollberichte (`finalOutput`, Child-Messages, strukturierter Volloutput, Acceptance-Child-Report, Acceptance-Verify-stdout/stderr sowie Chain-Output-Text/-Structured-Output) nicht noch einmal in der Parent-Session persistiert werden. Der vollständige Child-Report bleibt über die bestehenden Artefakte verfügbar.

Die anderen lokalen Tools behalten ihre bereits bestehenden Core- oder `limitTextOutput()`-Grenzen. Es gibt bewusst kein Extension-seitiges aggregiertes Turn-Budget und keine Deduplizierungsdatenbank.

Plan- und Work-Instruktionen werden über `before_agent_start.systemPrompt` turn-lokal in den effektiven Systemprompt eingefügt. Sie werden nicht mehr als gleichartige Custom-Messages in der Session gespeichert. Der Plan-Handoff bleibt einmalig und wird weiterhin nur nach einem erfolgreich abgeschlossenen Planning-Turn erzeugt.

## Reproduzierbare lokale Szenarien

Die Regressionstests verwenden keine Provider-Aufrufe:

| Szenario                        | Nachweis                                                                                                                                             |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Normale Session / frische Usage | Doctor trennt Active Context von Lifetime Usage und berechnet Window/Trigger aus dem aktiven Modell.                                                 |
| Nach Compaction / Null-Usage    | Doctor zeigt `pending fresh usage`; alte Usage wird nur als Lifetime Usage geführt.                                                                  |
| Tool-heavy / Subagent-heavy     | Ein 30-KiB-Subagent-Payload wird durch den aktiven `tool_result`-Hook begrenzt; Bildblock, Fehlerstatus, Run-ID und Artefaktpfade bleiben erhalten.  |
| Wiederholte Workflow-Turns      | Workflow-Tests prüfen, dass die Instruction ausschließlich im systemPrompt liegt und keine Custom-Message erzeugt; der Handoff erscheint nur einmal. |

## Externer Coding-Agent-Core-Patch

Die folgenden Probleme gehören zu `@earendil-works/pi-coding-agent`, nicht zu einer lokalen Extension:

| Codepfad (0.84.1)                                                                                                         | Benötigte Änderung                                                                                                                                                                                                                                                 | Benötigte Tests                                                                                                                                           | Lokale Auswirkung/Risiko                                                                  |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `src/core/agent-session.ts`, `_checkCompaction()` und `prompt()`                                                          | Vor dem nächsten Provider-Request ein projiziertes Budget aus Branch, neuem User-Input, pending Messages, turn-lokalem Systemprompt und aktiven Tools verwenden. Bei fehlender Usage konservativ schätzen; keine Usage vor der letzten Compaction wiederverwenden. | gültige/fehlende/Null-Usage, neue User-/Extension-Nachricht, Modellwechsel auf kleineres/größeres Fenster, Compaction zwischen zwei Usages.               | Ohne Patch kann der Pre-Prompt-Check die neue Anfrage unterschätzen.                      |
| `src/core/agent-session.ts`, Agent-Continue-/Tool-Loop und `_handlePostAgentRun()`                                        | Nach einem persistierten Tool-Result und vor jedem weiteren Provider-Request prüfen und bei Bedarf die vorhandene Compaction mit gültigen Tool-Call/Result-Paaren ausführen.                                                                                       | mehrere große Tool-Results, genau eine proaktive Compaction vor Folge-Request, gültige Reihenfolge, keine Doppelcompaction, höchstens ein Overflow-Retry. | Ohne Patch wächst ein langer Tool-Loop bis zum nächsten `agent_end`.                      |
| `src/core/compaction/compaction.ts`, `CompactionSettings`, `generateSummaryWithUsage()` und `generateTurnPrefixSummary()` | Trigger-Headroom, Keep-Recent, normales Summary-Ziel und Split-Turn-Summary-Ziel trennen. Zielkonfiguration: Trigger ungefähr 80 %, Keep Recent 12k, normales Summary höchstens etwa 8k, Prefix deutlich kleiner.                                                  | 50/70/80/90 %, zwei Compactions, Summary+Recent klar unter Trigger, kein unkontrolliertes Summary-Wachstum.                                               | Der heutige `reserveTokens` steuert zugleich Trigger und Summary-Maximum.                 |
| `src/core/agent-session.ts`, `_runAutoCompaction()`/Overflow-Pfad                                                         | Strukturierte Outcomes/Events für disabled, not-needed, estimate, preparation/migration/no-range, auth/provider/abort failure, success und exhausted overflow retry bereitstellen.                                                                                 | jeder Outcome sichtbar, ein fehlgeschlagener Retry, keine Wiederholung erfolgreicher Assistant-Ausgabe.                                                   | Die lokale Resilience-Erweiterung kann nur bereits vorhandene Boundary-Events darstellen. |

Die Source-Maps des gepinnten Pakets verweisen auf diese `src/`-Pfade. Es wird kein `node_modules`-Patch gebaut und kein Upgrade vorgenommen. Ein künftiger Pin-Wechsel ist erst vertretbar, wenn der veröffentlichte Core-Patch exakt gepinnt ist und die genannten Runtime-Tests grün sind.
