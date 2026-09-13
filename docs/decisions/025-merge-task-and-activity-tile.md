# 025 — Aufgabe- und Aktivität-Kachel zu einer Kachel verschmolzen

## Kontext

Nach [Entscheidung 024](024-remove-verification-tile-and-phase-chain.md) zeigte
die `AUFGABE`-Kachel nur noch Titel und optionales Ziel — zu wenig Inhalt für
eine eigene gerahmte Fläche, während direkt daneben die `AKTIVITÄT`-Kachel den
tatsächlichen Laufstatus trug. Beide Kacheln kosteten damit doppelten
Rahmen-Overhead (zwei Ecken-Paare, zwei Rahmen-Zeilenpaare) für zusammen
kaum mehr Inhalt als eine Kachel gebraucht hätte.

## Entscheidung

`buildTaskTile()` und `buildActivityTile()` in `tool-renderers.ts` werden zu
einer Funktion `buildTaskActivityTile()` zusammengeführt:

- Titel bleibt `Aufgabe` (Groß-/Kleinschreibung wie in Entscheidung „Titel in
  normaler Schreibweise" unten).
- Badge und Ton übernehmen unverändert die Logik der vorherigen
  Aktivität-Kachel (Laufstatus `LÄUFT` während einer aktiven Zeile,
  `VERIFIZIERT`/`ABGESCHLOSSEN`/`FEHLER`/`BEREIT` im Leerlauf über
  `sessionStatus()`/`statusLabel()`).
- Inhaltszeilen: Aufgabentitel (fett), optionales Ziel (gedimmt), danach die
  Aktivitätszeilen (laufende Tools/Subagenten) bzw. im Leerlauf die
  Standardmeldung „Bereit für die nächste Aufgabe."/„Letzte Aufgabe
  abgeschlossen.".

`layoutDashboardTiles()` verliert damit den `activityTile`- und
`prioritizeActivity`-Parameter — es gibt nur noch bis zu zwei Kacheln
(`Aufgabe`/`Änderungen`), die Reihenfolge zwischen „Aufgabe" und „Aktivität"
war ohnehin hinfällig, sobald beide dieselbe Kachel sind.

Gleichzeitig wurden die verbliebenen Kachel-Titel („AUFGABE", „ÄNDERUNGEN")
auf normale Groß-/Kleinschreibung umgestellt (`Aufgabe`, `Änderungen`);
Badges (`LÄUFT`, `BEREIT`, Verdikt-artige Labels) bleiben Großbuchstaben als
etablierte Status-Chip-Konvention.

## Konsequenzen

- Mit nur noch höchstens zwei Kacheln ist die „ungerade Kachel bleibt allein"-
  Situation aus [Entscheidung 023](023-single-dashboard-surface.md) praktisch
  verschwunden: zwei Kacheln paaren sich im Grid immer zu einer Zeile, eine
  einzelne Kachel steht ohnehin allein.
- `tests/suites/runtime/aurora-ui.mjs`: alle Text-Assertions auf die
  Großschreibung `"AUFGABE"`/`"AKTIVITÄT"`/`"ÄNDERUNGEN"` sind auf
  `"Aufgabe"`/`"Änderungen"` umgestellt; die separate `"AKTIVITÄT"`-Prüfung
  entfällt, da dieser Titel nicht mehr existiert. Die Budget-Matrix für die
  `ÄNDERUNGEN`-Kachel ist neu aufgeteilt: im Grid (≥ 90 Spalten) passt sie
  jetzt bei jedem Budget, weil nur noch eine gepaarte Zeile existiert und die
  erste Zeile nie verworfen wird; echter Budgetdruck zeigt sich nur noch im
  gestapelten Modus unterhalb der Grid-Schwelle.
