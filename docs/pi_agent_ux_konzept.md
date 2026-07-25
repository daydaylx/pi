# Pi Agent – UX & Design Konzept

## Shortcuts

| Shortcut | Funktion |
| --- | --- |
| `Shift+Tab` | Arbeits-Overlay: Workflows, Review & To-dos, Skills |
| `Super+M` | Globale Modelle und feste Scopes |
| `Super+D` | Denktiefe und Status-Telemetrie |
| `Super+Q` | Modell, Berechtigungen, Werkzeuge, Thinking und System |

Die Shortcuts gelten im fokussierten Pi-Terminal und benötigen für `Super`
das Kitty-/CSI-u-Protokoll. Sie werden nicht als systemweite Linux-Mint-Hotkeys
registriert.

## Modelle und Thinking

`Super+M` zeigt alle verfügbaren Registry-Modelle sowie die von Pi über
`/scoped-models` beziehungsweise `settings.enabledModels` ausgewählten Modelle.
Die Anzeige enthält Registry-Status, Kontextfenster, Output-Limit, Preisraten
und vorhandenen Kontextverbrauch.

`Super+D` bietet Auto sowie die vom aktiven Modell unterstützten Thinking-Stufen
einschließlich `Off`. Die Telemetrie zeigt nur Status, Dauer und Tool-Aktivität;
sie zeigt keine internen Modellgedanken und bietet kein frei wählbares
Reasoning-Token-Budget.

## Skills und Konfiguration

Die Skill-Bibliothek verwendet nur die von Pi bereits registrierten nativen
`/skill:<name>`-Kommandos. `Space` merkt Skills für die nächste Aufgabe vor;
bei deren Start wird der Agent angewiesen, die zugehörigen `SKILL.md`-Dateien
zu laden. Eigene Skills und Extensions werden im Overlay nur mit Status und
Verwaltungshinweisen dargestellt; die Laufzeit-TUI verändert keine Dateien und
lädt Extensions nicht dynamisch nach.
