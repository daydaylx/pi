# REAL DUEL #001 — TUI-Warmtheme-Überarbeitung

```
Base:
696c61f00d312d4b9e8155a1605dfc38784347b4

Task:
benchmarks/real-duel/tasks/real-01-tui-warm-theme/instruction.md
(vollständiger, wortgleicher Nutzerauftrag: CLI/TUI-Audit + warmes Theme
fuer extensions/aurora-ui/, kein Benchmark-Vokabular)

Main model:
gpt-5.6-terra (beide Arme, Reasoning: high)
```

|                                                | PI                                                                          | CODEX                                                       |
| ---------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Functional (typecheck/format/deadcode/patches) | PASS                                                                        | PASS                                                        |
| Functional (test:coverage)                     | **FAIL — 3/1170** (Regression)                                              | PASS — 1378/1378                                            |
| Functional (test:gui)                          | FAIL (bekannter, vorbestehender Gap — nicht durch diese Aufgabe verursacht) | FAIL (derselbe bekannte Gap)                                |
| Requirements (Nicht-Ziele eingehalten)         | PASS                                                                        | PASS                                                        |
| Blind Review (2x, Reihenfolge vertauscht)      | LOSS / LOSS                                                                 | **WIN / WIN**                                               |
| Rückfragen                                     | 0                                                                           | 0                                                           |
| Runtime                                        | 516,9 s                                                                     | 577,1 s                                                     |
| Model Calls (Turns)                            | 32                                                                          | 1 (\*)                                                      |
| Fresh Input                                    | 121.250                                                                     | 139.110                                                     |
| Cache Read                                     | 2.521.088                                                                   | 3.602.688                                                   |
| Output                                         | 19.558                                                                      | 19.717                                                      |
| Reasoning                                      | 6.926                                                                       | 7.688                                                       |
| Tool Calls                                     | 82                                                                          | 26                                                          |
| Tool Errors                                    | 5                                                                           | 3                                                           |
| Subagents                                      | 0 (Aufgabe hat keine ausgelöst)                                             | –                                                           |
| Compactions                                    | 0                                                                           | –                                                           |
| Cost                                           | $0,98 (`pi_usage_cost_field`)                                               | unavailable (Codex meldet keine Kosten in `turn.completed`) |

(\*) Codex' `turns` zählt `turn.completed`-Events; bei diesem Lauf hat Codex
die gesamte Aufgabe intern als einen einzigen Turn mit 26 Tool-Aufrufen
abgewickelt, waehrend Pi 32 separate Turns (`turn_end`) erzeugt hat. Das ist
ein Unterschied in der jeweiligen internen Turn-Granularität, keine direkt
vergleichbare "Modellaufruf"-Zahl — nicht als "Codex brauchte 32x weniger
Modellaufrufe" fehlinterpretieren.

## Funktionale Bewertung im Detail

Beide Agenten arbeiteten ausschliesslich im erlaubten Scope
(`extensions/aurora-ui/`, `extensions/shared/ui-theme.ts`, `themes/`,
zugehörige Tests) — keiner hat `gui/`, `extensions/shared/shortcuts.ts`
oder Agenten-/Workflow-Logik angefasst.

**Pi** ersetzte das Theme, entkernte das Footer-Pill-System und benannte die
komplette `vars`-Struktur im Theme um (`bg`→`background` usw.) — ohne die
einzige Testdatei zu aktualisieren, die die alten hartcodierten Hex-Werte
prüft (`tests/suites/runtime/target-config.mjs`). Ergebnis: 3 echte
Testfehler. **Pi hat das selbst erkannt**: die letzte Textantwort dokumentiert
explizit "⚠️ Kanonisches `project_check(verify)` blockiert: lokales
`prettier` fehlt (Exit 127). Keine Abhängigkeit installiert." — Pi versuchte,
sein Verify-Tool zu nutzen, aber die frische Git-Worktree hatte keine
installierten `node_modules`, und Pi hat (anders als Codex) an keiner Stelle
selbst `npm install`/`npm ci` ausgeführt. Zusätzlich wurden zwei von Pis
eigenen Testlauf-Versuchen von seinem eigenen Permission-System abgelehnt
("Aktion vom Benutzer abgelehnt" — 2 der 5 Tool-Errors), was Pi in seiner
Antwort ebenfalls transparent vermerkte ("von der Ausführungsfreigabe
abgelehnt; ich wiederhole sie nicht").

**Codex** führte proaktiv `npm --prefix npm ci --ignore-scripts` aus, bevor
es iterativ typecheck/tests/verify lief liess, fixte dabei entdeckte Probleme
(u. a. eine fehlgeschlagene "installer"-Prüfung im Zwischenstand) und
aktualisierte `tests/suites/runtime/target-config.mjs` korrekt auf die neuen
Theme-Werte. Der letzte `npm run verify`-Lauf war bei Codex bereits während
der eigenen Arbeit grün (bestätigt durch unsere unabhängige Nachprüfung).

Der `test:gui`-Fehlschlag (Format-Drift `gui/renderer/{index.html,styles.css}`)
ist bei **beiden** identisch und nachweislich vorbestehend (siehe
`REAL_DUEL_AUDIT.md` §10) — keiner der beiden Patches hat `gui/` verändert.

## Blind-Patch-Review (2x, Positionsbias-Kontrolle)

Zwei unabhängige, frische Reviewer-Agenten ohne Kenntnis der
Werkzeugidentität bewerteten die anonymisierten Patches je einmal in
Reihenfolge A/B und B/A:

- **Runde 1** (A=Pi, B=Codex): WINNER B (Codex)
- **Runde 2** (A=Codex, B=Pi): WINNER A (Codex)

Beide Runden identifizieren unabhängig voneinander **dieselben zwei
konkreten, im Basis-Code vorhandenen Rendering-Bugs, die nur Codex behoben
hat**: eine Off-by-One-Spaltenbreite im 2×2-Tile-Grid bei geraden
Terminalbreiten (erzeugt genau die im Auftrag beschriebene
"Hintergrundflächen und Rahmen nutzen nicht dieselben Grenzen"), sowie eine
Titel-Truncation, die das Status-Badge bei langen Titeln komplett verdrängt.
Beide Reviews bewerten Codex zusätzlich als scope-treuer und wartbarer;
Runde 2 vermerkt umgekehrt, dass Pi eine sauberere Farbdifferenzierung
zwischen "Working" und "Responding" liefert — ein echter, kleiner
Pi-Vorteil, der das Gesamturteil aber nicht kippt.

**Ergebnis robust gegen Positionsbias: WINNER Codex.**

## Interpretation

- Codex hat diese eine Aufgabe sowohl funktional (grüne Testsuite,
  keine Regression) als auch im blinden Patch-Vergleich (2/2) gewonnen.
- Der entscheidende Unterschied war nicht Modellqualität im engeren Sinn,
  sondern **Verifikationsdisziplin**: Codex bootstrappte sein Environment
  selbst (`npm ci`) und konnte dadurch iterativ gegen echte Testergebnisse
  arbeiten; Pi versuchte dasselbe über sein eigenes `verify`-Tool, scheiterte
  an einer fehlenden Abhängigkeit und arbeitete den Rest des Laufs ohne
  funktionierendes Sicherheitsnetz weiter — mit einer entsprechenden,
  unentdeckten Regression als Folge.
- Pi war bei Runtime (516,9 s vs. 577,1 s), Tool-Calls (82 vs. 26 — mehr
  granulare Einzelschritte) und Kosten ($0,98 vs. nicht meldbar) nicht
  eindeutig unterlegen; Codex' Kosten sind schlicht nicht messbar (kein
  Cost-Feld in `turn.completed`), nicht nachweislich niedriger.
- Ein einzelner Lauf einer einzelnen Aufgabe ist **kein allgemeines
  Pi-vs-Codex-Ranking**. Das konkrete Ergebnis (Pi vergisst einen
  Testabgleich nach Rename, weil sein eigener Verify-Versuch an fehlenden
  Dependencies scheiterte) ist eine spezifische, reproduzierbare
  Beobachtung zu genau diesem Lauf — kein Beleg für generelle
  Modell-/Harness-Überlegenheit. Für belastbare Aussagen sind mindestens
  3 Wiederholungen vom selben Base-SHA nötig (Phase 6, noch nicht
  durchgeführt).
- Bemerkenswert und in beiden Armen identisch: kein Rückfragen-Verhalten
  (headless Modus unterstützt das strukturell nicht), beide haben den
  fehlenden Screenshot transparent vermerkt statt zu halluzinieren.

## Artefakte

- Patches (lokal, nicht committet): `patch_pi.diff` / `patch_codex.diff`
  im Session-Scratchpad — nicht Teil dieses Reports, da sie echten
  Produktcode enthalten und vor einem eventuellen Merge separat begutachtet
  werden sollten, nicht blind aus einem Benchmark-Lauf übernommen.
- Rohtranskripte, Fingerprint, `results.jsonl`-Zeilen:
  `~/.local/state/real-duel/obench-workspace/` (lokal, nicht committet).
- Worktrees für diesen Lauf wurden nach Erstellung dieses Reports entfernt
  (`pi-duel cleanup real-01-tui-warm-theme-20260905T032441`).
