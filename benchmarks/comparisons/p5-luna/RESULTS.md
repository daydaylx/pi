# RESULTS — P5-LUNA-HARNESS

## Smoketest (n=1 je Harness — Machbarkeitsnachweis, keine belastbare Aussage)

Aufgabe: `05-refactor-no-behavior-change`.

| Metrik                       | Pi (`p5-smoke-05-pi`)                                                           | Codex (`p5-smoke-05-codex`)                                                     |
| ---------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Evaluator-Status             | `pass` (11/11 Assertions)                                                       | `pass` (11/11 Assertions)                                                       |
| Modell aufgelöst             | `openai-codex/gpt-5.6-luna`                                                     | `gpt-5.6-luna` (Codex-CLI, dieselbe ChatGPT-Backend-Route)                      |
| Reasoning Effort aufgelöst   | `high`                                                                          | `high`                                                                          |
| Modellaufrufe (`modelCalls`) | 20                                                                              | 6                                                                               |
| Tokens input                 | 65.390                                                                          | 482.036                                                                         |
| Tokens output                | 8.055                                                                           | 3.560                                                                           |
| Tokens reasoning             | 2.992                                                                           | 1.717                                                                           |
| Tokens cacheRead             | 722.432                                                                         | 437.504                                                                         |
| Tokens cacheWrite            | 0                                                                               | 0                                                                               |
| Tokens providerReportedTotal | 795.877                                                                         | 485.596                                                                         |
| Laufzeit (durationMs)        | 613.396 (~10,2 Min)                                                             | 460.597 (~7,7 Min)                                                              |
| Fehlgeschlagene Tool-Aufrufe | 5                                                                               | 1                                                                               |
| Tool-Aufrufe gesamt          | n/a (nicht separat erfasst, nur `failedToolCalls`)                              | 8                                                                               |
| Subagentenaufrufe            | 0 (Investigator/Debugger nicht delegiert — legitim, siehe METHODOLOGY.md)       | 0 (kein `multi_agent`-Thread ausgelöst)                                         |
| Geänderte Dateien            | `benchmark-fixture/diff-viewer/change-tracker.ts` (exakt 1, im erlaubten Scope) | `benchmark-fixture/diff-viewer/change-tracker.ts` (exakt 1, im erlaubten Scope) |
| networkToolCallsObserved     | 0                                                                               | 0                                                                               |

**Vorläufige Beobachtung (n=1, nicht belastbar):** Codex verwendet für dieselbe Aufgabe deutlich mehr Input-/Cache-Read-Tokens (482K vs. 65K Input) bei weniger Modellaufrufen (6 vs. 20) und etwas kürzerer Laufzeit. Beide Seiten lösten die Aufgabe korrekt, exakt im erlaubten Scope, ohne Netzwerkzugriff. Eine Interpretation des Token-/Aufruf-Unterschieds (z. B. unterschiedliche Kontextaufbereitung pro Turn) ist erst mit mehreren Wiederholungen sinnvoll — siehe ANALYSIS.md.

Rohdaten: `RAW/runs/p5-smoke-05-pi/` (Kopie von `~/.local/state/pi-p5/runs/p5-smoke-05-pi/`), `RAW/runs/p5-smoke-05-codex/` (Kopie von `~/.local/state/pi-p5/runs/p5-smoke-05-codex/`).

## Voller Pilot (18 Läufe: `05`, `02`, `08` × Pi/Codex × 3 Wiederholungen — `04`/`09` gestrichen, siehe METHODOLOGY.md)

**Läuft — dieser Abschnitt wird laufend ergänzt, sobald jede Aufgabe vollständig durch ist.**

### Aufgabe 05 — `05-refactor-no-behavior-change` (abgeschlossen)

| Run                  | Status   | Zieldatei geändert             | Modellaufrufe | Input-Tokens | Output-Tokens | Laufzeit |
| -------------------- | -------- | ------------------------------ | ------------- | ------------ | ------------- | -------- |
| p5-pilot-05-pi-r1    | fail     | nein (Rückfrage statt Handeln) | 3             | 22.195       | 659           | 38 s     |
| p5-pilot-05-pi-r2    | **pass** | ja                             | 14            | 62.354       | 5.984         | 742 s    |
| p5-pilot-05-pi-r3    | fail     | nein (Rückfrage statt Handeln) | 6             | 35.548       | 1.154         | 48 s     |
| p5-pilot-05-codex-r1 | **pass** | ja                             | 8             | 1.449.114    | 6.659         | 344 s    |
| p5-pilot-05-codex-r2 | **pass** | ja                             | 9             | 1.822.782    | 6.998         | 277 s    |
| p5-pilot-05-codex-r3 | **pass** | ja                             | 9             | 1.637.309    | 8.642         | 412 s    |

**Erfolgsquote: Pi 1/3, Codex 3/3.** 2 von 3 Pi-Läufen (r1, r3) endeten mit einer Rückfrage statt einer Aktion (siehe ANALYSIS.md, "Methodischer Hinweis"); im dritten Lauf (r2) hat Pi die Aufgabe korrekt gelöst. Codex hat alle 3 Wiederholungen konsistent gelöst.

**Token-Beobachtung:** Codex verbraucht durchgehend ~25–50× mehr Input-Tokens als Pi für dieselbe Aufgabe (1,4–1,8 Mio. vs. 22–62 Tsd.). Wichtige Einordnung: Bei Codex macht `cacheRead` fast den gesamten `input`-Wert aus (z. B. r2: 1.822.782 input, davon 1.740.032 cacheRead — nur ~4,5 % tatsächlich frisch verarbeitet), ebenso bei Pi (r2: 62.354 input, davon 320.512 — hier ist cacheRead sogar größer als input, was auf separates Session-Caching hindeutet). D. h. ein Großteil der rohen Token-Zahl ist gecachter, güntiger Kontext, kein frischer Verarbeitungsaufwand — der Unterschied in tatsächlichen API-Kosten dürfte deutlich kleiner ausfallen als der rohe Token-Unterschied suggeriert. Trotzdem bleibt die absolute Kontextmenge (frisch+gecacht kombiniert) bei Codex ca. 10× größer als bei Pi — eine echte, durchgängige Beobachtung über alle 3 Wiederholungen, deren Ursache (System-Prompt-Größe, Tool-Definitionen, wiederholtes Volleinlesen von Dateien vs. Pi's Kontextmanagement) erst durch Trace-Analyse geklärt werden kann, nicht durch die Zahlen allein.

### Aufgabe 02 — `02-local-bug` (abgeschlossen)

| Run                  | Status | Modellaufrufe | Input-Tokens | Output-Tokens | Fehlgeschl. Tool-Aufrufe | Laufzeit |
| -------------------- | ------ | ------------- | ------------ | ------------- | ------------------------ | -------- |
| p5-pilot-02-pi-r1    | pass   | 15            | 55.326       | 4.412         | 6                        | 247 s    |
| p5-pilot-02-pi-r2    | pass   | 12            | 66.547       | 3.988         | 4                        | 288 s    |
| p5-pilot-02-pi-r3    | pass   | 13            | 51.552       | 3.726         | 6                        | 235 s    |
| p5-pilot-02-codex-r1 | pass   | 5             | 594.914      | 2.804         | 2                        | 119 s    |
| p5-pilot-02-codex-r2 | pass   | 7             | 974.550      | 3.898         | 2                        | 162 s    |
| p5-pilot-02-codex-r3 | pass   | 7             | 979.827      | 4.276         | 2                        | 184 s    |

**Erfolgsquote: Pi 3/3, Codex 3/3.** Beide Seiten lösen den injizierten Off-by-one-Bug in allen 3 Wiederholungen korrekt, jeweils exakt in der einen erlaubten Datei (`benchmark-fixture/diff-viewer/diff-algorithm.ts`), kein Scope-Verstoß. Codex ist durchgehend schneller (2–3 Min vs. 4–5 Min) und hat weniger fehlgeschlagene Tool-Aufrufe (2 vs. 4–6), verbraucht aber wie bei Aufgabe 05 deutlich mehr Input-Tokens (~10–18× mehr).

### Aufgabe 08 — `08-long-session-compaction` (abgeschlossen, aber **nicht auswertbar**)

| Run                  | Status | Modellaufrufe | Input-Tokens | Laufzeit | Diff |
| -------------------- | ------ | ------------- | ------------ | -------- | ---- |
| p5-pilot-08-pi-r1    | fail   | 3             | 12.048       | 39 s     | leer |
| p5-pilot-08-pi-r2    | fail   | 1             | 14.440       | 11 s     | leer |
| p5-pilot-08-pi-r3    | fail   | 6             | 30.849       | 52 s     | leer |
| p5-pilot-08-codex-r1 | fail   | 1             | 16.906       | 20 s     | leer |
| p5-pilot-08-codex-r2 | fail   | 3             | 502.377      | 107 s    | leer |
| p5-pilot-08-codex-r3 | fail   | 1             | 16.876       | 315 s    | leer |

**6/6 Läufe fail, leerer Diff auf beiden Seiten, in allen 6 Wiederholungen.** Ursache: der öffentliche v2-Prompt ("Untersuche und löse die beschriebene, mehrteilige Aufgabe...") enthält keine tatsächliche Aufgabenbeschreibung — anders als bei Aufgabe 05 gibt es keinen einzigen im Repository auffindbaren Anhaltspunkt. Beide Systeme haben das in jeder Wiederholung unabhängig korrekt erkannt und um Klärung gebeten, die im erzwungenen Einzelschuss-Modus nie eintreffen kann (siehe ANALYSIS.md). **Diese Aufgabe wird aus der Erfolgsraten-/Effizienz-Auswertung ausgeschlossen** — die 6 Läufe sind kein Aussage über Pi/Codex-Fähigkeit, sondern Beleg für einen defekten Prompt (wie Aufgabe 04, nur erst durch Ausführung statt Vorab-Prüfung entdeckt).

Rohdaten aller 20 Läufe (2 Smoketest + 18 Pilot): `RAW/runs/<run-id>/`.
