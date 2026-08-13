# 010 — Compaction-Budget nach Messung: Reserve 48 KiB, Recent 20 KiB

## Kontext

Die frühere Fassung dieser Entscheidung behielt `keepRecentTokens: 12000` bei,
weil der einzige durchgeführte Vergleichslauf scheiterte: 14 Assistant-Turns,
152.146 Tokens, **keine persistierte Compaction**. Der Wert war damit nie gegen
einen Lauf gemessen, der die Schwelle überhaupt erreicht hat. Dasselbe galt für
`reserveTokens: 32768`.

Statt weitere kostenpflichtige Modellläufe zu starten, wurde diesmal direkt
gegen die installierte Runtime (`0.84.1`) und gegen 12 reale Session-Transkripte
aus `sessions/` gemessen. Alle Zahlen stammen aus den Funktionen der Runtime
selbst (`shouldCompact`, `findCutPoint`, `estimateTokens`,
`sessionEntryToContextMessages`), nicht aus Schätzungen.

## Ausgangsmessung

| Größe                          | Wert                                            | Quelle              |
| ------------------------------ | ----------------------------------------------- | ------------------- |
| Kontextfenster `gpt-5.6-terra` | 272.000                                         | `models-store.json` |
| Trigger                        | `contextTokens > contextWindow − reserveTokens` | `compaction.js:160` |
| Summary-Budget                 | `min(0,8 × reserveTokens, model.maxTokens)`     | `compaction.js:461` |
| Upstream-Default               | `reserve 16384` / `keepRecent 20000`            | `compaction.js:74`  |

Mit `reserve 32768` ergab das eine Schwelle von **239.232 Tokens = 88,0 %**.
Nach einer Compaction blieben höchstens Summary (26.214) + Recent (12.000)
= **38.214 Tokens = 14,0 %** des Fensters übrig: ein Sprung von 88 % auf 14 %,
also bis zu 201.018 verdichtete Tokens in einem Schritt.

Entscheidend war die zweite Messung — wie stark wächst ein realer Turn zwischen
zwei Compaction-Prüfungen? Über 75 Turns aus 12 Sessions, gezählt nur mit dem,
was tatsächlich ans Modell geht:

| Perzentil | Tokenzuwachs eines Turns |
| --------- | ------------------------ |
| p50       | 13.776                   |
| p75       | 35.501                   |
| p90       | 57.842                   |
| p95       | 93.655                   |
| max       | 150.626                  |

**25,3 % der realen Turns wuchsen um mehr als die gesamte Reserve von 32.768.**
Kein einzelner Eintrag überschritt die Reserve (größter: 12.831) — das Risiko
ist kumulativ innerhalb eines Turns, nicht ein einzelnes großes Toolergebnis.

Das ist der eigentliche Befund: Wenn die Compaction bei 88 % auslöst, ist die
verbleibende Reserve kleiner als ein durchschnittlicher Turn. Die Runtime fängt
einen Überlauf zwar ab, aber nur mit **einem** Versuch — schlägt
`_overflowRecoveryAttempted` fehl, endet der Turn mit „Context overflow recovery
failed after one compact-and-retry attempt" (`agent-session.js:1542`).

## Entscheidung

`settings.json`:

- `reserveTokens: 32768 → 49152`
- `keepRecentTokens: 12000 → 20000` (der Upstream-Default)

Ergebnis der Nachmessung:

|                                   | vorher           | nachher              |
| --------------------------------- | ---------------- | -------------------- |
| Auslöseschwelle                   | 239.232 (88,0 %) | 222.848 (**81,9 %**) |
| Summary-Budget                    | 26.214           | 39.321               |
| Kontext nach Compaction           | 38.214 (14,0 %)  | 59.321 (**21,8 %**)  |
| Turns über der Reserve            | 25,3 %           | **14,7 %**           |
| Erhaltene Entries (Ø, 6 Sessions) | 13,0 %           | **18,1 %**           |

`reserveTokens` steuert beides — Schwelle **und** Summary-Budget. Die Erhöhung
verschiebt die Auslösung in das Band von 80–85 %, das für diese Arbeitslast
gefordert war, und vergrößert gleichzeitig das Budget für die Zusammenfassung.
`keepRecentTokens` geht auf den Upstream-Default zurück; die Absenkung auf 12.000
hatte nie eine Messung hinter sich.

24.000 Recent Tokens wurden mitgemessen (20,7 % erhaltene Entries, 23,3 % des
Fensters) und **nicht** übernommen: Der Zugewinn gegenüber 20.000 ist kleiner
als der Sprung von 12.000 auf 20.000, und 20.000 ist zusätzlich der Wert, den
Upstream selbst verwendet und pflegt.

## Konsequenzen

- Die Werte sind in `tests/suites/runtime.mjs` festgenagelt: Recent nie unter
  dem Runtime-Default, Reserve über dem Doppelten des Runtime-Defaults, Trigger
  höchstens 85 %, und das Randverhalten von `shouldCompact` (`>`, nicht `>=`)
  ist mitgeprüft. Ein stiller Rückbau fällt damit sofort auf.
- Keine zweite Compaction-Schicht, keine `turn_end`-Extension, kein
  Core-Patch, kein zweites Memory-System. Die Runtime prüft weiterhin an ihren
  eigenen Punkten; verändert wurde ausschließlich, ab wann und mit welchem
  Budget sie das tut.
- Nicht gemessen und damit offen: der reale Qualitätsunterschied der erzeugten
  Zusammenfassung bei 26.214 gegenüber 39.321 Tokens Budget. Dafür wäre ein
  Modellvergleich nötig; die hier getroffene Entscheidung hängt nicht davon ab.
