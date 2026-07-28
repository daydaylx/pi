# 009 — Aurora besitzt auch die Fußzeile

## Kontext

[007](007-aurora-single-ui-owner.md) hielt fest, `pi-zentui` besitze die Fußzeile
und lese die Statuswerte über `zentui.json`. Das traf zum Zeitpunkt der
Entscheidung womöglich zu, aber nicht mehr: `extensions/aurora-ui/index.ts` ruft
`ctx.ui.setFooter(…)` selbst auf, und `tests/run.mjs` hält seit der
Paketbereinigung ausdrücklich fest, dass die drei früheren UI-Pakete keine
aktiven Laufzeitpakete mehr sind — sie bleiben nur als exakte Pins für einen
deterministischen Typecheck installiert.

`zentui.json` steuerte damit nichts. Wer die Fußzeile ändern wollte, editierte
`footerFormat`, `footerSegments` oder `contextThresholds` und sah keine Wirkung.
Dasselbe galt für `extensions/pi-tool-display/config.json`.

## Entscheidung

Aurora ist der einzige Besitzer der gesamten TUI-Chrome, Fußzeile eingeschlossen.
`zentui.json` und `extensions/pi-tool-display/config.json` sind gelöscht. Die
npm-Pins in `npm/package.json` bleiben unverändert — sie tragen den Typecheck,
nicht die Laufzeit.

Die Fußzeile ist zugleich die einzige Statusfläche. Modell, Denktiefe, Projekt,
Berechtigung, LSP und Kontext stehen dort und auf keiner zweiten Fläche; der
Editorrahmen trägt nur noch Arbeitsablauf und Schritt.

## Begründung

Konfiguration, die nichts steuert, ist teurer als keine Konfiguration: sie sieht
aus wie ein Stellhebel, kostet bei jeder Suche eine Prüfung und widerspricht der
Dokumentation, ohne dass ein Test das bemerkt.

Die doppelte Statusanzeige hatte denselben Charakter. Modell, Denktiefe, Kontext
und Arbeitsablauf standen gleichzeitig im Editorrahmen und in der Fußzeile — im
breiten Layout vier Rahmenzeilen um das Eingabefeld, mit zwei verschiedenen
Darstellungen desselben Kontextwerts.

## Konsequenzen

- 007 gilt weiter, außer in der Aussage zur Fußzeile; diese Entscheidung ersetzt
  sie dort.
- `UI_STATUS_KEYS` behält seine Stringwerte. Der Grund ist jetzt ein anderer:
  nicht `zentui.json`, sondern `aurora-ui/footer.ts` liest sie.
- Berechtigungen erscheinen in der Fußzeile als kurzer Modus-Label aus
  `PERMISSION_LEVEL_LABEL` (`Projekt schreiben`), nicht als Risikobanner des
  `permissions`-Statuskanals (`🛡 DEFAULT · PROJECT WRITE`). Das Banner bleibt
  für Dialoge reserviert; für ein Fußzeilensegment ist es zu breit.
- Ein Test prüft, dass beide Konfigurationsdateien nicht wiederkehren — dieselbe
  Form, die 007 für die fünf gelöschten Chrome-Dateien gewählt hat.
