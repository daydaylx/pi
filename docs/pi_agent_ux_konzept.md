# Pi Agent – UX & Design Konzept

## Shortcuts

| Shortcut | Funktion |
| --- | --- |
| `Shift+Tab` | `/workflow` |
| `Super+P` | `/plan` |
| `Super+M` | `/model` |
| `Super+D` | `/thinking` |
| `Super+Y` | `/yolo` |
| `Super+S` | `/agent-models` |
| `Super+Q` | `/commands` |

`/commands` teilt die kanonischen Namen, Kategorien und Beschreibungen
zwischen Menü, Autocomplete und Shortcuts (`extensions/shared/command-catalog.ts`
ist dafür die einzige Quelle). Freitextsuche über alle Commands gibt es aber
nur im nativen Autocomplete; das Command-Center-Menü selbst bietet keine
Texteingabe, sondern ausschließlich Pfeiltasten-Navigation und den
Kategorie-Buchstaben als Einzeltasten-Sprung. Das Hauptmenü besteht aus Arbeit
(`A`), Plan (`P`), Modelle & Denken (`M`), Rechte & Vertrauen (`R`), Code &
Diagnose (`C`), Sitzungen & Kontext (`S`), Vorlagen & Skills (`V`) sowie
System & Transfer (`T`). Ein Buchstabe öffnet den Bereich direkt. Einträge
zeigen den kanonischen `/command`; Aliase werden nur am Original erklärt.

`/workflow` trennt Planarbeit und Direktauftrag. Planarbeit startet oder setzt
ausschließlich einen vorhandenen Plan fort; ein Direktauftrag ist die kompakte,
planlose Alternative mit Scope, Verifikation und Abschlusskriterien.

Die Shortcuts gelten im fokussierten Pi-Terminal und benötigen für `Super`
das Kitty-/CSI-u-Protokoll. Sie werden nicht als systemweite Linux-Mint-Hotkeys
registriert.

## Modelle und Thinking

`Super+M` zeigt die über `settings.enabledModels` freigegebenen Modelle.
Die Anzeige enthält Registry-Status, Kontextfenster, Output-Limit, Preisraten
und vorhandenen Kontextverbrauch.

`Super+D` bietet Auto sowie die vom aktiven Modell unterstützten Thinking-Stufen
einschließlich `Off`. Im Auto-Modus folgt die Denktiefe dem Workflow; eine
manuell gewählte Stufe bleibt unangetastet. Eine separate Status-Telemetrie-
Ansicht gibt es nicht mehr — der Status steht in der Fußzeile.

## Skills und Konfiguration

Das Command Center verwendet nur die von Pi registrierten nativen
`/skill:<name>`-Kommandos. Es zeigt ausschließlich aktive Skill-Commands und
die aktuell geladenen Prompt-Vorlagen; die Laufzeit-TUI verändert keine Dateien
und lädt Extensions nicht dynamisch nach.
