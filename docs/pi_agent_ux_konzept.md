# Pi Agent – UX & Design Konzept

## Shortcuts

| Shortcut    | Funktion    |
| ----------- | ----------- |
| `Shift+Tab` | Workflow wählen |
| `Super+M`   | `/model`    |
| `Super+D`   | `/thinking` |
| `Super+Y`   | `/yolo`     |
| `Super+Q`   | `/commands` |

`/commands` teilt die kanonischen Namen, Kategorien und Beschreibungen
zwischen Menü, Autocomplete und Shortcuts (`extensions/shared/command-catalog.ts`
ist dafür die einzige Quelle). Freitextsuche über alle Commands gibt es aber
nur im nativen Autocomplete; das Command-Center-Menü selbst bietet keine
Texteingabe, sondern ausschließlich Pfeiltasten-Navigation und den
Kategorie-Buchstaben als Einzeltasten-Sprung. Das Hauptmenü besteht aus Arbeit
(`A`), Plan (`P`), Modelle & Denken (`M`), Rechte & Vertrauen (`R`), Code &
Diagnose (`C`), Subagenten (`S`), Sitzungen & Kontext (`Z`), Vorlagen & Skills (`V`) sowie
System & Transfer (`T`). Ein Buchstabe öffnet den Bereich direkt. Einträge
zeigen den kanonischen `/command`; Aliase werden nur am Original erklärt.

Shift+Tab ist die einzige normale Workflow-Steuerung und bietet nur Work,
Schnellplan und Architekturplan. Die Auswahl wartet auf die nächste echte
Nutzereingabe und startet selbst keinen Turn. Ein vorhandener Plan bleibt bis
zum Planning-Turn unverändert; ein gerade in derselben Sitzung erzeugter Plan
kann beim nächsten Work-Turn einmalig hilfreicher Kontext sein.

Die Shortcuts gelten im fokussierten Pi-Terminal und benötigen für `Super`
das Kitty-/CSI-u-Protokoll. Sie werden nicht als systemweite Linux-Mint-Hotkeys
registriert.

## Modelle und Thinking

`Super+M` übergibt an Pis kanonisches `/model`. Dieses Repository registriert
keinen eigenen Modell-Handler, also bestimmt Pi selbst, welche Metadaten der
Picker zeigt; freigegeben sind die Modelle aus `settings.enabledModels`.

`Super+D` öffnet die Denktiefe in derselben Menüschale wie das Command Center
(`shared/menu-ui.ts`) — eine flache Liste der sechs Stufen von `Aus` bis
`Sehr hoch`, ausschließlich manuell wählbar. Stufen, die das aktive Modell
nicht kennt, stehen deaktiviert in der Liste statt zu verschwinden: die Skala
bleibt dieselbe, und die Lücke sagt „dieses Modell kann das nicht". Eine automatische,
workflowabhängige Vorauswahl gibt es zur Laufzeit nicht. Eine frühere
`detailed_plan → high`-Zuordnung (`extensions/plan-mode/events.ts`) reagierte
auf ein Event, für das weder dieses Repository noch das installierte
`@earendil-works/pi-coding-agent`-Paket (geprüft im installierten
`node_modules`) einen Sender besaßen — bestätigt toter Code ohne Consumer,
inzwischen entfernt. Eine separate Status-Telemetrie-Ansicht gibt es nicht
mehr — der Status steht in der Fußzeile.

## Statusflächen

Es gibt genau zwei, und nur eine davon ist permanent.

Die **Fußzeile** ist eine Zeile und trägt Arbeitsablauf, Modell, Denktiefe,
Kontextanteil und Verifikationsstand. Wird es eng, fallen ganze Segmente vom
unwichtigen Ende her weg statt am Rand abgeschnitten zu werden. Riskantes —
YOLO, gescheiterte Verifikation, gestörter LSP — ignoriert die Größenklasse und
verdrängt Gewöhnliches. Git-Branch, Sitzungsname und Tokenzähler stehen nicht mehr dort; das
Arbeitsverzeichnis erscheint weiterhin kompakt als Session-Ordner. Siehe
`docs/decisions/009-aurora-owns-the-footer.md`.

Das **Activity-Widget** über dem Eingabefeld erscheint nur während eines Turns
und zeigt Denkphase, laufende Tools und Subagenten als flache Liste. Jede
Tool-Zeile benennt Typ, Ziel, Status und Dauer; abgeschlossene Arbeit
verschwindet, statt zu einem Erfolgsblock zu werden. In kleinen Terminals
bleiben Einträge bis zum Viewport sichtbar, danach fasst Aurora sie
statusgenau zusammen.

Die Größenklassen beider Flächen und der Menüs stehen gemeinsam in
`extensions/shared/layout.ts`: kompakt unter 52×14, komfortabel ab 90×28, breit
ab 120×30.

## Eingabefeld

Das Eingabefeld erweitert Pis `CustomEditor` ausschließlich um zwei ruhige,
beschriftete Rahmenlinien. Textbearbeitung, History, Completion, Cursor und
Shortcuts delegiert Aurora vollständig an Pi. Der Editor wächst mit dem Inhalt,
reserviert keine Höhe im Voraus, scrollt intern ab
`max(5, 30 % der Terminalzeilen)` und erhält dabei Cursorposition und Text
(`pi-tui/dist/components/editor.js`).

Damit sind die Eigenschaften erfüllt, auf die es ankommt — mitwachsen, nichts
dauerhaft reservieren, kein Sprung beim Öffnen eines Menüs, da Menüs Overlays
sind. Die genauen Grenzen weichen ab: die Untergrenze ist eine Zeile statt drei
(drei leere Zeilen wären genau die Reservierung, die vermieden werden soll), und
die Obergrenze erreicht 15 Zeilen erst bei etwa 50 Terminalzeilen. Diese Werte
nachzubilden hieße, Pis Editor-Layout für Kosmetik nachzubauen — der Preis steht
in keinem Verhältnis zum Unterschied. Der Accent-Titel `EINGABE` macht den
fokussierten Interaktionsbereich sichtbar, ohne zusätzliche Höhe oder eine
zweite Statusfläche zu erzeugen.

## Skills und Konfiguration

Das Command Center verwendet nur die von Pi registrierten nativen
`/skill:<name>`-Kommandos. Es zeigt ausschließlich aktive Skill-Commands und
die aktuell geladenen Prompt-Vorlagen; die Laufzeit-TUI verändert keine Dateien
und lädt Extensions nicht dynamisch nach.
