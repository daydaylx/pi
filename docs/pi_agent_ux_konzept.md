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
ist dafür die einzige Quelle). Das Command-Center besitzt eine Texteingabe mit
Fuzzy-Filter: Tippen grenzt die sichtbaren Einträge ein, Backspace bearbeitet
den Filter, Escape löscht zunächst den Filter und schließt erst beim leeren
Filter das Menü. Kategorie-Shortcuts gelten nur bei leerem Filter; Enter
verankert die Auswahl nach einem Filterwechsel neu. Das Hauptmenü besteht aus
Arbeit (`A`), Plan (`P`), Modelle & Denken (`M`), Rechte & Vertrauen (`R`), Code
& Diagnose (`C`), Subagenten (`S`), Sitzungen & Kontext (`Z`), Vorlagen & Skills
(`V`) sowie System & Transfer (`T`). Ein Buchstabe öffnet den Bereich direkt.
Einträge zeigen den kanonischen `/command`; Aliase werden nur am Original
erklärt.

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

Es gibt zwei Renderer-Slots, und nur die Fußzeile ist permanent.

Die **Fußzeile** ist eine Zeile und trägt Arbeitsablauf, Modell, Denktiefe,
Kontextanteil und eskalierte Risiken. Wird es eng, fallen ganze Segmente vom
unwichtigen Ende her weg statt am Rand abgeschnitten zu werden. YOLO,
gescheiterte Verifikation und gestörter LSP ignorieren die Größenklasse und
verdrängen Gewöhnliches. Ab komfortabler Breite erscheinen Arbeitsablauf und
Risiken als gefüllte Status-Chips (Pills), Routine-Metadaten bleiben flach;
schmale Klassen behalten den flachen Look. Git-Branch, Sitzungsname und
Tokenzähler stehen nicht mehr dort; das Arbeitsverzeichnis erscheint weiterhin
kompakt als Session-Ordner. Siehe
`docs/decisions/009-aurora-owns-the-footer.md`.

Das **Aurora-Widget** über dem Eingabefeld enthält das Session-Dashboard und,
während eines Turns, die flache Activity-Liste mit Denkphase, laufenden Tools
und Subagenten. Die Flächen sind als gefüllte Kacheln mit Titelzeile,
Status-Pills und beschrifteten Feldern angelegt; Hintergründe laufen
ausschließlich über die acht festen `Theme.bg`-Flächen, damit jedes Theme
korrekt bleibt. Ab breiter Größe ordnet sich das Expanded-Dashboard als
zweispaltiges Kachel-Grid (Aufgabe + Aktivität, Änderungen + Prüfungen).
`ui.dashboard` steuert das Dashboard über `auto` (Default),
`compact`, `expanded` oder `hidden`; `/dashboard` schaltet es ohne neuen
Shortcut um. Auto priorisiert fehlgeschlagene oder stale Verifikation vor
Routineinformationen, nutzt in kleinen Terminals höchstens zwei Zeilen und
verdichtet Idle-Informationen statt Null-Aussagen zu zeigen. Während aktiver
Arbeit benennen Tool-Zeilen Typ, Ziel, Status und Dauer; abgeschlossene Arbeit
verschwindet statt zu einem Erfolgsblock zu werden. Phase und
Verifikationsurteil teilen dieselbe Staleness-Definition; Details stehen in
Decision 019.

Die Größenklassen beider Flächen und der Menüs stehen gemeinsam in
`extensions/shared/layout.ts`: kompakt unter 52×14, komfortabel ab 90×28, breit
ab 120×30.

## Eingabefeld

Das Eingabefeld ist unverändert Pis eigener Editor. Aurora installiert keine
eigene Editor-Komponente, sodass Textbearbeitung, History, Completion, Cursor,
Shortcuts sowie `editorPaddingX` und `autocompleteMaxVisible` aus
`settings.json` direkt aus der Laufzeit kommen. Der Editor wächst mit dem
Inhalt, reserviert keine Höhe im Voraus, scrollt intern ab
`max(5, 30 % der Terminalzeilen)` und erhält dabei Cursorposition und Text
(`pi-tui/dist/components/editor.js`).

Damit sind die Eigenschaften erfüllt, auf die es ankommt — mitwachsen, nichts
dauerhaft reservieren, kein Sprung beim Öffnen eines Menüs, da Menüs Overlays
sind. Die früheren beschrifteten Rahmenlinien (`EINGABE`, `Enter senden`)
stammten aus einer eigenen `CustomEditor`-Subklasse; sie sind entfernt, weil
Dekoration keine dauerhafte Kopplung an Editor-Interna und keine zweite
Konfigurationsquelle für Editor-Einstellungen wert ist
(`docs/decisions/013-aurora-keeps-the-native-editor.md`).

## Skills und Konfiguration

Das Command Center verwendet nur die von Pi registrierten nativen
`/skill:<name>`-Kommandos. Es zeigt ausschließlich aktive Skill-Commands und
die aktuell geladenen Prompt-Vorlagen; die Laufzeit-TUI verändert keine Dateien
und lädt Extensions nicht dynamisch nach.
