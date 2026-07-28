# 007 — Aurora ist einziger aktiver UI-Besitzer

## Kontext

Vor Aurora besaßen eigene Extensions Teile der Oberfläche: `git-header.ts`
(Startkopf), `activity-status.ts` (Aktivitätszeile), `thinking-view.ts` mit
`thinking-view-config.ts` (Thinking-Statuszeile), `context-menu.ts`
(Kontextmenü). Nach der Umstellung waren sie in `settings.json` deaktiviert,
blieben aber im Baum liegen — eine frühere Entscheidung lautete, sie „inaktiv zu
erhalten (Rückbau ohne Datenverlust)".

## Entscheidung

Die fünf Dateien sind gelöscht. Aurora (`extensions/aurora-ui/`) besitzt Editor,
Widget, Aktivität und Motion; `pi-zentui` besitzt die Fußzeile und liest die
Statuswerte aus `UI_STATUS_KEYS` (`workflow`, `permissions`, `lsp`), belegt über
`zentui.json`.

## Begründung

Inaktiver Code ist nicht kostenlos: er wurde weiter getestet, weiter
typgeprüft, hielt Eventkanäle am Leben, die niemand mehr auslöste, und ließ bei
jeder Suche offen, welche Datei die gültige ist. Der Datenverlust, den die
frühere Entscheidung fürchtete, tritt nicht ein — die Git-Historie ist die
Rückfallebene.

## Konsequenzen

- `CONTROL_CENTER_EVENTS` enthält nur noch Kanäle mit Emitter und Listener.
  `openContext`, `openChanges`, `snapshot` und `openThinkingView` sind entfernt.
- `ZENTUI_STATUS_KEYS` heißt `UI_STATUS_KEYS`; die Stringwerte sind unverändert,
  weil `zentui.json` sie als Platzierungsschlüssel referenziert.
- `tests/run.mjs` prüft, dass die fünf Dateien nicht mehr existieren — die
  stärkere Aussage als „ist deaktiviert".
- Diese Entscheidung ersetzt den älteren Ledger-Eintrag zur Aufbewahrung
  inaktiver UI-Dateien.
