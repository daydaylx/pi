# 009 — Aurora besitzt auch die Fußzeile

## Kontext

[007](007-aurora-single-ui-owner.md) hielt fest, `pi-zentui` besitze die Fußzeile
und lese die Statuswerte über `zentui.json`. Das traf zum Zeitpunkt der
Entscheidung womöglich zu, aber nicht mehr: `extensions/aurora-ui/index.ts` ruft
`ctx.ui.setFooter(…)` selbst auf, und `tests/run.mjs` hält seit der
Paketbereinigung ausdrücklich fest, dass die früheren UI-Pakete keine aktiven
Laufzeitpakete mehr sind. Die für den Typecheck nötigen Pins bleiben installiert.

`zentui.json` steuerte damit nichts. Wer die Fußzeile ändern wollte, editierte
`footerFormat`, `footerSegments` oder `contextThresholds` und sah keine Wirkung.
Dasselbe galt für `extensions/pi-tool-display/config.json`.

Die ursprüngliche Fassung dieser Entscheidung teilte den Status danach auf zwei
Flächen auf: die Fußzeile trug Modell, Denktiefe, Projekt, Berechtigung, LSP und
Kontext, der Editorrahmen trug den Arbeitsablauf. Das war eine Verbesserung
gegenüber der doppelten Anzeige davor, aber es blieb eine Aufteilung ohne Grund
— und der Rahmen kostete dauerhaft eine Zeile direkt über dem Eingabefeld.

## Entscheidung

Aurora ist der einzige Besitzer der gesamten TUI-Chrome, Fußzeile eingeschlossen.
`zentui.json` und `extensions/pi-tool-display/config.json` sind gelöscht. Die
npm-Pins für die noch benötigten Typen in `npm/package.json` bleiben unverändert
— sie tragen den Typecheck, nicht die Laufzeit.

Die Fußzeile bleibt das permanente globale Statusband und **eine einzige
Zeile**. Sie trägt Arbeitsablauf, Modell und kritische Hinweise; bei wenig Platz
verdrängen YOLO, gescheiterte Verifikation und gestörter LSP die Routinewerte.

Das Dashboard oberhalb des Editors ist die zweite, dauerhafte Oberfläche für
den konkreten Arbeitsstand: Aufgabe, Phase, laufende Arbeit, Änderungen und
Prüfungen. Es zeigt ausschließlich bereits vorhandene Runtime-Daten und wird
auf kleinen oder niedrigen Terminals zu einer kompakten Zusammenfassung.
Aurora installiert keinen eigenen Editor; Bearbeiten, History, Completion und
Shortcuts bleiben vollständig bei Pi.

## Begründung

Konfiguration, die nichts steuert, ist teurer als keine Konfiguration: sie sieht
aus wie ein Stellhebel, kostet bei jeder Suche eine Prüfung und widerspricht der
Dokumentation, ohne dass ein Test das bemerkt.

Die dauerhafte Aufteilung folgt nun der Nutzeraufgabe: Das globale Statusband
bleibt kurz, während der Arbeitsstand als kompakte Übersicht direkt am Editor
sichtbar ist. Das verhindert, dass technische Footer-Segmente mit Aufgaben-,
Änderungs- und Prüfdetails um dieselbe Zeile konkurrieren. Die responsive
Zeilenbudgetierung erhält auf kleinen Terminals die Editorfläche und lässt
kritische Hinweise nie verschwinden.

Was die Fußzeile nicht mehr zeigt — Git-Branch, Sitzungsname und
Tokenzähler —, ist auf Abruf verfügbar (`/session`). Eine permanente Zeile ist
der falsche Ort für Werte, die man einmal pro Sitzung braucht.

> **Nachtrag:** Die aktuelle Aurora-Fußzeile zeigt zusätzlich den aus dem
> Session-CWD abgeleiteten, kompakten Ordnernamen.

Die Berechtigungsstufe erscheint nur noch, wenn sie riskant ist. Eine ruhige
Stufe permanent anzuzeigen trainiert an, die Stelle zu ignorieren, an der YOLO
später auftaucht.

## Konsequenzen

- 007 gilt weiter, außer in der Aussage zur Fußzeile; diese Entscheidung ersetzt
  sie dort.
- `UI_STATUS_KEYS` behält seine Stringwerte. Der Grund ist jetzt ein anderer:
  nicht `zentui.json`, sondern `aurora-ui/footer.ts` liest sie.
- Das Risikobanner des `permissions`-Statuskanals (`🛡 DEFAULT · PROJECT WRITE`)
  bleibt Dialogen vorbehalten. Die Fußzeile liest den Modus vom Aurora-Bus und
  zeigt ihn nur als `⚠ YOLO`, wenn er riskant ist.
- Die Größenklassen stehen in `extensions/shared/layout.ts` und gelten für
  Menüs und Fußzeile gemeinsam. Vorher hatten beide eigene Grenzen (52/90
  gegenüber 76/124).
- `renderFooterLines` ist rein und liest ausschließlich Runtime-State. Es
  startet keinen Prozess, prüft weder Git noch LSP, fragt keinen Provider und
  liest keine Datei. Ein Test hält fest, dass es beim Rendern nicht durch den
  Session-Branch läuft.
- Subagenten stehen nicht mehr in der Fußzeile, sondern im Dashboard beim
  auslösenden Tool. Die Statusabfrage dorthin läuft ereignisgesteuert statt bei
  jedem Frame.
- Ein Test prüft, dass beide gelöschten Konfigurationsdateien nicht wiederkehren
  — dieselbe Form, die 007 für die fünf gelöschten Chrome-Dateien gewählt hat.
