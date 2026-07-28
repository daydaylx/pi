# Pi Agent – UX & Design Konzept

## Shortcuts

| Shortcut | Funktion |
| --- | --- |
| `Shift+Tab` | Workflow wechseln: Schnellplan, Architekturplan, Planarbeit oder Direktauftrag |
| `Super+P` | Planwahl (identisch mit `/plan`) |
| `Super+M` | Modellwahl |
| `Super+D` | Denktiefe |
| `Super+Y` | Temporärer YOLO-Modus |
| `Super+Q` | Vollständiges Control Center; erster Reiter ist der Workflow-Wechsel |

`Shift+Tab` und `Super+Q` bauen auf derselben Menü-Definition auf und laufen
durch denselben Handler. Sie unterscheiden sich nur im Umfang, nie im Inhalt
eines Eintrags. Planarbeit startet oder setzt ausschließlich einen vorhandenen
Plan fort; ein Direktauftrag ist die kompakte, planlose Alternative mit Scope,
Verifikation und Abschlusskriterien.

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

Die Skill-Bibliothek verwendet nur die von Pi bereits registrierten nativen
`/skill:<name>`-Kommandos. `Space` merkt Skills für die nächste Aufgabe vor;
bei deren Start wird der Agent angewiesen, die zugehörigen `SKILL.md`-Dateien
zu laden. Eigene Skills und Extensions werden im Overlay nur mit Status und
Verwaltungshinweisen dargestellt; die Laufzeit-TUI verändert keine Dateien und
lädt Extensions nicht dynamisch nach.
