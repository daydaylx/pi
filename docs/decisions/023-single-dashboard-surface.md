# 023 — Eine Dashboard-Fläche statt fixem Panel plus Kachel-Grid

## Kontext

Zwischen dem 11. und 12.09. entstand über vier Commits (`68da993`, `f778c1e`,
`92c8161`, `4f20908`) ein zweites, dauerhaft fixes „Sitzung“-Panel
(`header.ts`, via `ctx.ui.setHeader`), das parallel zum vollständigen
Vier-Kachel-Dashboard (`Aufgabe`/`Aktivität`/`Änderungen`/`Prüfungen`, via
`ctx.ui.setWidget`) lief. Beide Flächen zeigten großteils dieselben Daten
(Status, Subagenten, Änderungen, Verifikation) doppelt und verdoppelten damit
den permanenten Platzverbrauch über dem Editor — auf kleinen Terminals blieb
kaum noch Raum für den eigentlichen Gesprächsverlauf.

Das widersprach der bestehenden
[Entscheidung 019](019-dashboard-modes-and-phase-precedence.md), die explizit
eine einzige „responsive permanente Standardansicht“ beschreibt. Der Zustand
vor dem 11.09. (z. B. Commit `616dbdc`, 05.09.) kannte kein separates
Sitzungs-Panel — nur das Kachel-Dashboard.

## Entscheidung

Zurück zu einer sichtbaren Dashboard-Fläche, für alle Terminalbreiten:

- `header.ts` verliert seinen gerahmten Panel-Teil (`renderHeaderLines`,
  `sessionDetails`, `bodyLimit`) und bleibt nur als reine
  Status-Projektion bestehen: `sessionStatus`, `statusLabel`, `statusTone`.
- Solange ein Turn läuft, trägt die Überschriftszeile innerhalb der
  `AKTIVITÄT`-Kachel bereits den detaillierten Status samt Timer (z. B.
  „Denkt nach · Hoch · 3s“) — eine zusätzliche Statusbadge würde das nur
  doppeln (genau die Doppelung, die ADR 019 schon einmal bemängelt hat).
  Erst wenn nichts läuft, übernimmt die Badge den einzigen verbleibenden Job
  des früheren Sitzungs-Panels: `BEREIT` gegen einen abgeschlossenen
  `VERIFIZIERT`/`ABGESCHLOSSEN`/`FEHLER`-Zustand zu unterscheiden
  (`buildActivityTile` in `tool-renderers.ts`).
- Die einzige Einzelinformation aus dem Panel, die in keiner Kachel vorkam
  (`Tests X/Y`), zeigt jetzt die `PRÜFUNGEN`-Kachel zusätzlich an, wenn
  `verification.testsPassed`/`testsTotal` gesetzt sind.
- `index.ts` ruft `ctx.ui.setHeader(...)` nicht mehr auf; das Dashboard bleibt
  die einzige Fläche über dem Editor.

Im selben Zug wurden zwei Layout-Fehler behoben, die das Kachel-Dashboard auch
für sich genommen auf schmalen Terminals schlecht lesbar machten:

- Kachel-Inhalte (Fortschrittsbalken, laufende Tools, Subagenten-Zweige)
  werden jetzt gegen die tatsächliche Spaltenbreite gerendert
  (`dashboardTileWidth()`), statt gegen die volle Terminalbreite mit
  anschließendem zweiten Crop auf die halbe Grid-Spalte.
- Die Phasenkette (`renderProgressBar`) schaltet unterhalb eines
  Breiten-Schwellenwerts auf eine kompakte Glyphen-Form um, statt mitten in
  einem Phasenlabel abgeschnitten zu werden.

## Konsequenzen

- Nur noch eine gerahmte Fläche über dem Editor; `ui.dashboard`
  (`auto|compact|expanded|hidden`) steuert diese eine Fläche statt zwei
  unabhängige Sichtbarkeits-Prüfungen.
- `tests/suites/runtime/aurora-ui.mjs` prüft den Laufstatus jetzt über
  `renderDashboard()`/die Aktivitätskachel statt über das entfernte
  `header.renderHeaderLines`.
- `tile.ts`s interne Breiten-Schwellen (`FRAMED_MIN_WIDTH`,
  `FRAMED_PAIR_MIN_WIDTH`) sind jetzt benannt und voneinander abgeleitet, statt
  isolierter Magic Numbers, die unbemerkt gegen den Grid-Schwellenwert in
  `tool-renderers.ts` (`LAYOUT_COLUMNS.comfortable`) driften konnten.
