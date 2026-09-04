# Plan-Evaluation

Der Qualitätsgate in `extensions/plan-mode/plan-quality.ts` prüft, ob ein Plan
die *Form* seines Modus hat. Ob er fachlich taugt — trifft er die richtige
Änderungssurface, belegt er seine Aussagen, zieht er unnötige Bereiche herein,
könnte man ihn tatsächlich umsetzen — ist damit nicht beantwortet. Dafür gibt es
diese kleine Suite.

## Aufbau

| Datei | Inhalt |
| --- | --- |
| `tests/plan-eval/tasks.mjs` | Acht realistische Aufgaben mit erwarteter und verbotener Änderungssurface |
| `tests/plan-eval/score.mjs` | Die Bewertung, getrennt in mechanische und Urteilskriterien |
| `tests/plan-eval/quality-bridge.mjs` | Lädt denselben Qualitätsgate, den das Produkt durchsetzt |
| `tests/plan-eval/fixtures/` | Referenzpläne, an denen der Scorer selbst geprüft wird |
| `tests/plan-eval/run.mjs` | Der Läufer |
| `tests/workflow-mode/plan-eval.test.mjs` | Testet den Scorer (läuft in CI mit) |

Die acht Aufgaben decken die geforderten Arten ab: bekannte kleine Änderung,
unbekannter Bug, Multi-Datei-Feature, Architekturänderung,
Security-/Permission-Aufgabe, Migration, eine Contract-/Frontend-Aufgabe und
eine ungeeignete Aufgabe, bei der der Planmodus unnötig ist.

## Mechanisch vs. Urteil — die Trennung ist der Punkt

Mechanisch entschieden und damit wiederholbar:

`structure`, `surface-hit`, `surface-creep`, `verification`, `acceptance`,
`risks`, `non-goals`, `proportionality`.

Nicht mechanisch entschieden und **getrennt** ausgewiesen:

`repository-facts-correct`, `sensible-questions`, `actually-implementable`.

Ein mechanisch prüfbares Kriterium wird nie durch ein Modellurteil ersetzt. „Nennt
der Plan die Datei, die er ändern müsste?" ist eine Tatsachenfrage; ein Judge,
der sie überstimmen darf, wird sie irgendwann falsch beantworten. Modellbasierte
Bewertungen gehören ausschließlich in die drei Urteilskriterien, werden separat
berichtet und sollten mehrfach gelaufen sein, bevor man ihnen traut.

`scorePlan()` gibt die Urteilskriterien immer als `"unbewertet"` zurück; ein
Reviewer trägt sie ein. Der Testfall „judgement criteria are reported but never
scored mechanically" hält das fest.

## Bewerten

Referenzpläne (offline, ohne Provider):

```bash
node tests/plan-eval/run.mjs
```

Echte Pläne bewerten — je Aufgabe eine `<task-id>.md` in einem Verzeichnis:

```bash
node tests/plan-eval/run.mjs --plans /pfad/zu/plaenen
```

Fehlende Pläne werden am Ende namentlich als „nicht bewertet" ausgewiesen, statt
den Schnitt stillschweigend zu beschönigen.

## Live-Lauf: noch offen

Ein Lauf gegen echte Modelle ist bewusst **nicht** in den Läufer verdrahtet: In
einen Testrunner gehören keine Provider-Credentials, und der wiederverwendbare
Teil sind Korpus und Bewertung. Für einen Live-Lauf startet man je Aufgabe eine
Pi-Sitzung im angegebenen Modus mit dem `prompt` der Aufgabe, exportiert den
entstandenen Plan als `<task-id>.md` und ruft `run.mjs --plans` darauf.

Stand dieser Änderung ist der Live-Lauf **nicht durchgeführt**: die Suite ist
vollständig, die mechanische Bewertung ist an den Referenzplänen verifiziert
(16/16), aber es liegen keine modellgenerierten Pläne und damit keine Zahlen zur
realen Planqualität vor.
