# ANALYSIS — P5-LUNA-HARNESS

**Status: Core-Parity-Pilot abgeschlossen (18 Läufe: 3 Aufgaben × 2 Harnesses × 3 Wiederholungen; `04`/`09` vorab gestrichen).** Davon sind 2 von 3 Aufgaben auswertbar (`05`, `02`); Aufgabe `08` musste wegen eines defekten Prompts aus der Auswertung ausgeschlossen werden. Stichprobe pro Zelle: n=3. Das ist die vom Nutzer angeforderte Mindeststichprobe, aber am unteren Ende dessen, was belastbare Prozentaussagen erlaubt — Formulierungen folgen durchgehend dem Muster "X von Y Läufen", nicht "X % besser" (Auftrag Abschnitt 17).

---

## 1. Benchmark-Gültigkeit

**War der Vergleich fair?** Ja, im Rahmen von Modus A (Core Parity): identisches Modell (`gpt-5.6-luna`, verifiziert aufgelöst auf beiden Seiten), identischer Reasoning Effort (`high`, verifiziert), identischer Referenzcommit, identische Prompts, identischer privater Evaluator, identische Wiederholungszahl, kein Webzugriff auf beiden Seiten (0 beobachtete Netzwerk-Tool-Aufrufe), keine externen Reviewer.

**Confounder (alle dokumentiert, siehe METHODOLOGY.md):**

- Netzwerk-Isolation ist strukturell asymmetrisch (Codex: OS-Sandbox; Pi: nur Paket-Entfernung + Post-hoc-Scan) — in der Praxis ohne Auswirkung (0/0 beobachtet).
- Aufgabe `08` ist wie spezifiziert unlösbar (leerer öffentlicher Prompt) — betrifft beide Seiten gleich, liefert aber keine auswertbaren Daten zur Aufgabenlösung selbst.
- Aufgabe `04` war vorab als unlösbar identifiziert und gestrichen (Zielkonstrukt existiert nicht mehr).
- Pis Skill-Auto-Loading versucht, Dateien über absolute Pfade außerhalb des isolierten Worktrees zu lesen (`/home/d/.pi/agent/skills/...`) — von Pis eigener Sicherheitsgrenze korrekt blockiert, kostet aber vereinzelt Tool-Aufrufe zu Beginn einer Sitzung. Kein Codex-Äquivalent bekannt.
- Kleine Stichprobe (n=3): einzelne Ausreißer (z. B. der eine erfolgreiche Pi-Lauf bei Aufgabe 05) können das Bild verzerren.

**Fazit Gültigkeit:** Der Vergleich ist methodisch sauber für die 2 auswertbaren Aufgaben. Für eine wirklich belastbare Aussage wäre die ursprünglich geplante größere Aufgaben- und Wiederholungszahl (5 Aufgaben × 5 Wiederholungen) nötig.

## 2. Pi-Schwächen

- **Rückfragen im Einzelschuss-Modus enden im Leeren:** Bei Aufgabe 05 endeten 2 von 3 Pi-Läufen damit, dass der Agent eine Klärungsfrage stellte (`ask_user` schlägt im `--print`-Modus explizit fehl: "Fehler: ask_user benötigt den interaktiven TUI-Modus"), statt die Aufgabe über Exploration zu lösen — obwohl die Zieldatei im Repository eindeutig auffindbar ist (nur eine Kandidatendatei unter `benchmark-fixture/`). Das ist **kein Modell-/Fähigkeitsdefizit** (Rückfragen bei echter Unsicherheit ist explizit erwünschtes Pi-Verhalten), sondern eine Harness-Eigenschaft: Pi neigt in diesem Setup stärker dazu, bei Mehrdeutigkeit zu pausieren, als sie durch Exploration aufzulösen — verglichen mit Codex, das in 6/6 Läufen (Aufgabe 05 + 02) ohne Rückfrage explorierte und löste.
- **Mehr fehlgeschlagene Tool-Aufrufe:** Bei Aufgabe 02: Pi 4–6 pro Lauf, Codex 2 pro Lauf. Bei Aufgabe 05 (Smoketest): Pi 5, Codex 1. Konsistent über beide auswertbaren Aufgaben — Pi tastet sich mit mehr Fehlversuchen voran.
- **Skill-Auto-Loading liest außerhalb des Worktrees** (siehe oben) — technisch korrekt abgefangen, aber unnötiger Reibungsverlust in genau der Art von isolierten Einzelschuss-Umgebung, wie sie dieser Benchmark verwendet.

## 3. Codex-Schwächen

- **Deutlich höherer Tokenverbrauch:** Über beide auswertbaren Aufgaben hinweg 10–50× mehr Input-Tokens als Pi (Aufgabe 05: 1,4–1,8 Mio. vs. 22–62 Tsd.; Aufgabe 02: 595 Tsd.–980 Tsd. vs. 52–67 Tsd.). Der Großteil ist gecachter Kontext (siehe RESULTS.md — bei Codex macht `cacheRead` oft >90 % des `input`-Werts aus), der reale Kostenunterschied ist daher vermutlich kleiner als der rohe Tokenunterschied suggeriert, aber die absolute Kontextmenge bleibt durchgehend um eine Größenordnung höher.
- **`codex exec` hat eine reale, gefundene Zuverlässigkeitslücke:** wartet ohne Weiteres auf stdin-EOF und hängt unbegrenzt, wenn stdin nicht explizit geschlossen wird (siehe METHODOLOGY.md) — kein Timeout, keine Fehlermeldung, reines Verharren. Für produktiven Automatisierungseinsatz eine reale Falle, unabhängig vom Modellvergleich.
- Keine erkennbare Tendenz zu Rückfragen bei Mehrdeutigkeit (0/6 in den auswertbaren Aufgaben) — im Gegensatz zu Pi tendenziell "handlungsfreudiger", was bei Aufgabe 05 zum Vorteil wurde, aber prinzipiell auch das Risiko voreiliger, falscher Annahmen birgt (in diesem Pilot nicht beobachtet, da alle Codex-Lösungen korrekt waren).

## 4. Erfolgsraten

| Aufgabe                 | Pi      | Codex   |
| ----------------------- | ------- | ------- |
| 05 (klein/präzise)      | 1/3     | 3/3     |
| 02 (Bugfix)             | 3/3     | 3/3     |
| **Gesamt (auswertbar)** | **4/6** | **6/6** |

Codex löste in diesem Pilot alle 6 auswertbaren Läufe korrekt; Pi 4 von 6, wobei beide Fehlschläge auf dieselbe Ursache zurückgehen (Rückfrage statt Aktion bei Aufgabe 05, nicht auf fehlerhafte Lösungsversuche). Bei Aufgabe 02 bestand vollständige Parität.

## 5. Effizienz

| Metrik        | Pi (Median, n=6) | Codex (Median, n=6) |
| ------------- | ---------------- | ------------------- |
| Input-Tokens  | ~53.500          | ~977.000            |
| Output-Tokens | ~4.070           | ~4.087              |
| Laufzeit      | ~246 s           | ~184 s              |
| Modellaufrufe | 13               | 7,5                 |

Codex ist im Median schneller (Wall-Clock) und braucht weniger Modellaufrufe, verbraucht dabei aber ca. 18× mehr Input-Tokens. Output-Tokens sind nahezu identisch. Min/Max und Ausreißer: Pis langsamster Lauf (05-r2, 742 s) ist zugleich sein einziger erfolgreicher Lauf bei Aufgabe 05 — der einzige Fall, in dem Pi tatsächlich die volle Explorations-/Implementierungsarbeit leistete, dauerte über 10× länger als seine beiden "Rückfrage"-Läufe.

## 6. Tool- und Harness-Verhalten

- Investigator/Debugger wurden in keinem der 6 auswertbaren Pi-Läufe delegiert (0 Subagentenaufrufe durchgehend) — beide Aufgaben waren dafür offenbar nicht komplex/riskant genug nach Pis eigenen Delegationskriterien (AGENTS.md). Codex' `multi_agent`-Feature wurde ebenfalls in keinem Lauf ausgelöst.
- Verifier war für beide Seiten deaktiviert (Modus-A-Vorgabe) — keine Aussage über Verifier-Nutzen aus diesem Pilot möglich.
- Codex' Rollout-Struktur (`CommandExecution`/`AgentMessage`/`FileChange`-Items) ist granularer typisiert als Pis Session-JSONL, was die automatische Metrik-Extraktion in diesem Fall sogar leichter machte, sobald die Feldnamen kalibriert waren.

## 7. Core-Parity-Ergebnis

Bei den 2 auswertbaren Aufgaben (n=3 je Zelle) löste Codex **6/6** Läufe korrekt, Pi **4/6** — beide Pi-Fehlschläge durch Rückfrage statt Aktion bei derselben Aufgabe (05), nicht durch falsche Lösungsversuche. Bei direkter Aufgabenparität (02) bestand Gleichstand 3/3 zu 3/3. Codex war durchgehend schneller und nutzte weniger Modellaufrufe, verbrauchte dabei aber deutlich mehr (großteils gecachte) Tokens.

**Vorsichtige Einordnung (n=3, nicht n=15+):** Die Daten deuten auf einen Codex-Vorteil bei mehrdeutigen/unterspezifizierten Einzelschuss-Aufgaben hin (Aufgabe 05), aber auf Parität bei klar spezifizierten Aufgaben (Aufgabe 02). Das ist eine Hypothese, keine gesicherte Schlussfolgerung — die Stichprobe ist zu klein, um Zufall auszuschließen (2 von 3 Pi-Fehlschlägen bei 05 könnten bei einer größeren Stichprobe genauso gut bei 1 von 10 oder 5 von 10 landen).

## 8. Native-Harness-Ergebnis

Nicht Teil dieser Serie (Modus B explizit ausgeschlossen, siehe Auftrag Abschnitt 7). Der Nutzer hat im Anschluss einen separaten Test mit erlaubten Subagenten (Modell `gpt-5.6-terra`, Pi-Produktivstack inkl. Sonnet-5-Verifier) angefordert — wird als eigene Serie geführt, nicht mit P5-LUNA-HARNESS vermischt.

## 9. Pi-Komponenten mit nachgewiesenem Nutzen

Aus diesem Pilot lässt sich **kein** Pi-spezifischer Komponentennutzen ableiten: Investigator, Debugger und Verifier waren in allen 6 auswertbaren Läufen inaktiv (0 Aufrufe bzw. deaktiviert). Der einzige nachweisbare Pi-Mechanismus, der aktiv beobachtet wurde, ist die **Rückfrage-statt-Raten-Logik** — deren Nutzen in diesem speziellen Single-Shot-Automatisierungskontext nicht nachgewiesen werden konnte (im Gegenteil: sie führte hier zu Aufgabenfehlschlägen), obwohl sie im interaktiven Alltagsbetrieb plausibel wertvoll ist. Eine Aussage zu Investigator/Debugger/Verifier-Nutzen erfordert Aufgaben, die tatsächlich deren Delegationskriterien auslösen — in diesem Pilot war keine der 2 auswertbaren Aufgaben komplex/riskant genug dafür.

## 10. Pi-Komponenten ohne nachgewiesenen Nutzen

- **Rückfrage-Mechanismus im automatisierten Single-Shot-Betrieb:** In diesem konkreten Benchmark-Modus (kein Rückkanal möglich) erzeugt er ausschließlich Fehlschläge, nie einen Vorteil. Das ist keine generelle Aussage über den Mechanismus (der im interaktiven Betrieb sinnvoll ist), sondern eine Aussage über seine Eignung für automatisierte, nicht-interaktive Ausführung — relevant, falls Pi künftig öfter in genau diesem Modus (CI, Batch, Benchmarks) betrieben werden soll.

## 11. Empfehlungen

- **Beibehalten:** Rückfrage-statt-Raten-Logik für interaktiven Betrieb — dieser Pilot hat keinen Grund geliefert, sie generell infrage zu stellen.
- **Verbessern:** Verhalten bei `ask_user` im `--print`-Modus — aktuell verpufft die Rückfrage ergebnislos; ein Hinweis an das Modell, dass im aktuellen Modus keine Rückfrage möglich ist (bevor es sie versucht, nicht erst als Fehlermeldung danach), könnte helfen, häufiger auf Exploration statt Rückfrage auszuweichen.
- **Verbessern:** Skill-Auto-Loading sollte projektrelativ statt über absolute Installationspfade auflösen, um unnötige Sicherheitsgrenzen-Ablehnungen in isolierten Worktrees zu vermeiden.
- **Weiter untersuchen:** Ob der Rückfrage-vs-Exploration-Unterschied bei Aufgabe 05 ein stabiles Muster oder ein Zufallsprodukt der kleinen Stichprobe ist — nur mit mehr Wiederholungen klärbar.
- **Weiter untersuchen:** Token-Effizienz-Unterschied (Pi deutlich sparsamer) — lohnt sich eine tiefere Trace-Analyse, was Codex pro Turn an zusätzlichem Kontext mitführt.
- **Entfernen:** Nichts — aus diesem begrenzten Pilot lässt sich keine Pi-Komponente als nachweislich nutzlos identifizieren (Investigator/Debugger/Verifier wurden gar nicht getestet, nicht als nutzlos befunden).

## 12. Fazit

**Für die 2 auswertbaren Aufgaben dieses Piloten: Codex leicht besser** — 6/6 vs. 4/6 Erfolgsquote, beide Pi-Fehlschläge auf denselben, klar benannten Mechanismus zurückführbar (Rückfrage im Einzelschuss-Modus), nicht auf fehlerhafte Lösungen. Bei direkter Aufgabenparität (02) bestand Gleichstand. Pi ist dafür deutlich tokeneffizienter.

Diese Aussage stützt sich auf n=3 pro Zelle bei 2 von ursprünglich 5 geplanten Aufgabenkategorien (2 weitere strichen sich wegen defekter Prompts selbst aus der Wertung) — für ein belastbareres Bild wäre die ursprünglich vorgesehene größere Serie (5 Aufgaben × 5 Wiederholungen, mit reparierten Prompts für 04/08/09) nötig. Die Infrastruktur dafür steht; die Aufgaben-Prompts selbst benötigen vor einer Neuauflage eine Überarbeitung (siehe METHODOLOGY.md).
