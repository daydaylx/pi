# 013 — Aurora behält Pis nativen Editor

## Kontext

[009](009-aurora-owns-the-footer.md) hielt fest, Aurora installiere „einen
schmalen `CustomEditor`-Ableger, der ausschließlich die beiden horizontalen
Eingaberails beschriftet und alle Bearbeitungs-, History-, Completion- und
Shortcutpfade an Pi delegiert". Das stimmte, war aber teurer als es aussah:

- `AuroraEditor` verdrahtete `paddingX: 1` und `autocompleteMaxVisible: 8` im
  Konstruktor fest. Dieselben Werte stehen als `editorPaddingX` und
  `autocompleteMaxVisible` in `settings.json`, wo sie damit wirkungslos waren —
  eine zweite Konfigurationsquelle für dieselbe Sache.
- Das Rendern der Rails ersetzte die erste und letzte Zeile des Ergebnisses von
  `super.render(width)` und rief `this.borderColor` und `this.focused` auf. Das
  ist eine Kopplung an Editor-Interna für reine Dekoration: Jede Änderung an
  Pis Editor-Rendering konnte die Rails oder das Eingabefeld beschädigen.

Der einzige Gewinn war die Beschriftung `EINGABE` / `Enter senden` auf einem
Rahmen, den Pis Editor ohnehin zeichnet.

## Entscheidung

`extensions/aurora-ui/editor.ts` ist gelöscht, und Aurora ruft
`ctx.ui.setEditorComponent()` nicht mehr auf. Aurora besitzt die Fußzeile und
das transiente Activity-Widget; das Eingabefeld ist unverändert Pis eigene
Komponente. `editorPaddingX` und `autocompleteMaxVisible` aus `settings.json`
wirken dadurch wieder.

Die Rails dürften nur zurückkommen, wenn sie ohne eigene Editor-Subklasse und
ohne Zugriff auf Core-Editor-Interna darstellbar wären.

## Begründung

Der Rahmen war Dekoration; die Kopplung war dauerhaft. Eine Subklasse einer
fremden UI-Komponente ist die teuerste Form, eine Beschriftung anzubringen: Sie
erbt jede zukünftige Änderung dieser Komponente und macht gleichzeitig deren
Konfiguration unerreichbar. Aurora verliert dabei nichts an Aussagekraft — der
Arbeitsablauf stand ohnehin nur in der Fußzeile, und die Aktivität steht im
Widget.

## Konsequenzen

- 009 gilt weiter, außer in der Aussage zum `CustomEditor`-Ableger; diese
  Entscheidung ersetzt sie dort.
- `tests/suites/runtime.mjs` prüft `harness.chrome` jetzt als
  `{ footer: 1, editor: 0, widget: 1, header: 0 }` und dass Aurora keine
  Editor-Factory registriert — die stärkere Aussage als „der Ableger delegiert
  korrekt".
- Bestehende Shortcuts, History und Autocomplete sind unverändert, weil sie nie
  von Aurora kamen.
- `extensions/aurora-ui/README.md` beschreibt nur noch Fußzeile und Widget als
  Auroras Flächen.
