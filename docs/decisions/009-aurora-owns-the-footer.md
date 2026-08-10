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

Die Fußzeile ist die einzige permanente Statusfläche und **eine einzige Zeile**.
Sie trägt in dieser Reihenfolge: Arbeitsablauf, Modell, Denktiefe, Kontext,
Verifikationsstand — und verdrängend davor alles Riskante (YOLO, gescheiterte
Verifikation, gestörter LSP).

Aurora zeigt keine zweite Statusfläche am Editor. Es installiert einen schmalen
`CustomEditor`-Ableger, der ausschließlich die beiden horizontalen Eingaberails
beschriftet und alle Bearbeitungs-, History-, Completion- und Shortcutpfade an
Pi delegiert. Der Arbeitsablauf steht weiterhin ausschließlich links in der
Fußzeile.

## Begründung

Konfiguration, die nichts steuert, ist teurer als keine Konfiguration: sie sieht
aus wie ein Stellhebel, kostet bei jeder Suche eine Prüfung und widerspricht der
Dokumentation, ohne dass ein Test das bemerkt.

Für die Aufteilung auf zwei Flächen galt dasselbe in kleinerem Maßstab. Ein Wert
war nur deshalb im Rahmen statt in der Fußzeile, weil er historisch dort stand.
Eine Fläche weniger heißt: eine Zeile mehr für Chat und Eingabe, keine Frage
mehr, wo ein Status steht, und kein Layout-Sprung über dem Eingabefeld. Die
später ergänzten Eingaberails tragen keinen Systemstatus und reservieren keine
zusätzliche Zeile; sie schaffen deshalb keine konkurrierende Fläche.

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
- Subagenten stehen nicht mehr in der Fußzeile, sondern im transienten
  Activity-Widget beim auslösenden Tool. Die Statusabfrage dorthin läuft
  ereignisgesteuert mit 300-ms-Coalescing statt bei jedem Frame.
- Ein Test prüft, dass beide gelöschten Konfigurationsdateien nicht wiederkehren
  — dieselbe Form, die 007 für die fünf gelöschten Chrome-Dateien gewählt hat.
