# 024 — PRÜFUNGEN-Kachel und Phasenkette aus dem Dashboard entfernt

## Kontext

Nach der Rückkehr zu einer Dashboard-Fläche ([Entscheidung 023](023-single-dashboard-surface.md))
blieben zwei Elemente, die auf Wunsch entfernt wurden:

- Die `PRÜFUNGEN`-Kachel (`buildVerificationTile`/`renderVerificationBlock` in
  `tool-renderers.ts`) zeigte Verdikt, Kriterien, Tests X/Y und Blocker als
  eigene, vierte Kachel.
- Die Phasenkette (`renderProgressBar` in der `AUFGABE`-Kachel) zeigte
  „● Verstehen ─ ● Planen ─ ● Arbeiten ─ ○ Prüfen ─ ○ Fertig“ als Textzeile.

## Entscheidung

Beides entfällt aus dem Dashboard:

- `buildTaskTile()` zeigt nur noch Titel und optionales Ziel, keine
  Phasenkette mehr. `renderProgressBar()` selbst bleibt als exportierte
  Funktion bestehen (weiterhin von `renderTaskWorkspace()` und eigenen Tests
  genutzt, aber nicht mehr vom aktiven Dashboard-Renderpfad aufgerufen).
- `buildVerificationTile()`, `renderVerificationBlock()` und die
  `bareVerificationTile`-Fallback-Logik in `layoutDashboardTiles()` sind
  vollständig entfernt. `layoutDashboardTiles()` ordnet jetzt nur noch
  `AUFGABE`/`AKTIVITÄT`/`ÄNDERUNGEN` — die frühere Sonderbehandlung für einen
  fehlgeschlagenen Verifikations-Verdikt (`hasFailure`-Reihenfolge,
  Budget-Rettung der Kachel) entfällt damit ebenfalls, da es nichts mehr zu
  retten gibt.
- `index.ts` ruft `dashboardOwnsVerification(...)` nicht mehr auf; die dazu
  gehörige Funktion in `shared/layout.ts` ist gelöscht, da sie keinen
  anderen Aufrufer hatte. Die Fußzeile (`footer.ts`) bekommt kein
  `dashboardVisible` mehr übergeben und ist damit die **einzige** permanente
  Oberfläche für Verifikationsstatus — sowohl Erfolg als auch Fehlschlag,
  vorbehaltlich der üblichen Breiten-Priorisierung, die auch jedes andere
  Metadatum bei sehr schmalen Terminals fallen lässt.
- Das AKTIVITÄT-Kachel-Badge (`buildActivityTile`, ungeändert seit
  Entscheidung 023) bleibt die einzige Dashboard-Stelle, an der ein
  fehlgeschlagener Verifikationsstand noch sichtbar wird: im Leerlauf zeigt
  die Badge `FEHLER` statt `BEREIT`, abgeleitet aus `sessionStatus()`.
- Vollständige Verifikationsdetails (Kriterien, Checks, Evidence) bleiben
  über `/inspect` → „Verification Evidence" abrufbar
  (`inspector-command.ts`, unverändert — hatte nie einen Bezug zu
  `renderVerificationBlock`).

## Konsequenzen

- `tests/suites/runtime/aurora-ui.mjs`: der direkte `renderVerificationBlock`-Test
  sowie die `hasFailure`-Budget-Matrix (getestet, dass die PRÜFUNGEN-Kachel
  Budgetdruck übersteht) sind entfernt, da die getestete Funktionalität nicht
  mehr existiert. Der `ÄNDERUNGEN`-Kachel-Budget-Schwellenwert sank von
  `maxRows >= 8` auf `maxRows >= 7`, weil mit einer Kachel weniger im Spiel
  mehr Zeilenbudget für die verbleibenden Kacheln übrig bleibt.
- Der Footer-Test, der zuvor prüfte, dass die Dashboard-Fläche die
  Routine-„verified“-Meldung bei Standardbreite unterdrückt, prüft jetzt das
  Gegenteil: die Fußzeile zeigt „verified“ jetzt bei Standardbreite, weil
  nichts anderes es mehr anzeigt; bei sehr schmaler Breite (40 Spalten) bleibt
  es weiterhin unsichtbar — dort jedoch aus einem anderen Grund (normale
  Breiten-Priorisierung nicht-kritischer Metadaten, nicht mehr wegen
  Dashboard-Besitz).
