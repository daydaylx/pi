# 026 — Mehr Bewegung: animierte Subagenten-Zeilen und Badge-Flash

## Kontext

Im gesamten Dashboard animierte bisher nur ein einzelnes Zeichen: der
drehende Braille-Cursor in der Aktivitäts-Überschriftszeile bei
`DENKT NACH`/`ARBEITET` (`activityGlyph()` in `index.ts`). Laufende
Subagenten-Zeilen zeigten einen starren `●`, und der Wechsel des
Aufgaben-Badges (z. B. `LÄUFT` → `VERIFIZIERT`) geschah geräuschlos.

## Entscheidung

**Subagenten-Zeilen** (`renderSubagentBranches()` in `tool-renderers.ts`):
neuer optionaler Parameter `runningGlyph?: string` — ein bereits fertig
eingefärbter String, der für `status === "running"`-Zeilen den statischen
`branchGlyph()`-Punkt ersetzt, sofern gesetzt und nicht leer. `index.ts`
berechnet ihn mit derselben `activityGlyph(theme, ticker?.motion, ticker?.frame, "tool")`,
die auch die Hauptzeile antreibt, und reicht ihn durch. Kein neues
Shared-Modul nötig, keine zirkuläre Abhängigkeit: `renderSubagentBranches()`
bekommt nur einen fertigen String, keine eigene Animationslogik. Für
`reduced`-Motion liefert `activityGlyph` denselben statischen, akzentfarbenen
Punkt wie zuvor (keine Verhaltensänderung); für `off` liefert sie `""`, der
leere String ist falsy und der Fallback auf `branchGlyph()` greift
automatisch.

**Badge-Flash** (`tile.ts`, `index.ts`): `renderPill()` bekommt einen
optionalen vierten Parameter `emphasize?: boolean`, der das Ergebnis
zusätzlich in `theme.inverse(...)` wrappt — dieselbe Technik, die der
bestehende `warning`-Zweig für garantierten Kontrast schon nutzt, jetzt aber
tonunabhängig, damit die semantische Farbe (Erfolg/Fehler) erhalten bleibt.
`TileInput.emphasizeBadge` reicht das bis zu `renderTileHeading()` durch.

`index.ts` verfolgt dafür den zuletzt gesehenen Ruhezustand
(`lastSettledStatus: SessionStatus | undefined`) und ein Zeitfenster
(`badgeHighlightUntil`, `BADGE_HIGHLIGHT_MS = 1500`). Wechselt der berechnete
Settled-Status (nur relevant, wenn `activityLines` leer ist — während eines
laufenden Turns trägt die Überschriftszeile den Status bereits) gegenüber dem
zuletzt gesehenen, wird das Fenster gesetzt und ein einmaliger
`setTimeout(() => ticker?.requestRender(), BADGE_HIGHLIGHT_MS)` gestartet.
Dieser eine zusätzliche Repaint ist nötig, weil der gemeinsame Ticker „nur
läuft, während Arbeit sichtbar ist" — nach dem Settle würde sonst überhaupt
nicht mehr neu gezeichnet, und der Flash bliebe für immer stehen, statt nach
Ablauf des Fensters zu verschwinden. Der Timer wird in der bestehenden
Dispose-Routine mit `clearTimeout` aufgeräumt.

## Konsequenzen

- `tests/suites/runtime/aurora-ui.mjs`: neue Unit-Tests für
  `renderSubagentBranches()`s `runningGlyph`-Parameter (animiert nur
  `"running"`, leerer String fällt auf den statischen Punkt zurück).
- Da der Test-Harness (`tests/shared/harness.mjs`) `theme.inverse` (wie alle
  Theme-Funktionen) auf eine reine Identitätsfunktion reduziert, lässt sich
  der Flash nicht über ANSI-Text-Assertions prüfen. Der Unit-Test für
  `highlightBadge` spioniert stattdessen `theme.inverse` direkt aus (eigenes
  Theme-Objekt mit überschriebener `inverse`-Funktion), um zu bestätigen,
  dass `renderDashboard()` sie genau dann aufruft, wenn `highlightBadge: true`
  gesetzt ist.
- Ein separater Integrationstest mit echter Wartezeit (kein gemockter
  `Date.now`, da `setTimeout` die reale Systemuhr nutzt) bestätigt, dass das
  Settle-Ereignis tatsächlich einen Timer registriert, der nach
  `BADGE_HIGHLIGHT_MS` einen zusätzlichen Repaint auslöst.
