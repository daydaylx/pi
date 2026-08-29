# Baseline-Shortcuts — semantische Erhebung (Phase 0)

Prinzip gemäß Auftragsdokument 02: Shortcuts werden als **semantische
Commands** erfasst, nicht als UI-Komponenten-Ziele. Diese Struktur existiert
im Repo bereits kanonisch in `extensions/shared/shortcuts.ts`
(`ShortcutBinding` mit `keys`, `command`, `effect`) — die GUI kann exakt
diese Tabelle übernehmen.

## Globale Bereichs-Shortcuts (extensions/shared/shortcuts.ts)

| Taste   | Command                | Wirkung                              | Effekt                |
| ------- | ---------------------- | ------------------------------------ | --------------------- |
| Super+M | `/model`               | Modellwahl-Menü                      | —                     |
| Super+D | `/thinking`            | Denktiefe-Menü                       | —                     |
| Super+Q | `/commands`            | Command Center (alle Bereiche)       | —                     |
| Super+Y | `/yolo`                | YOLO-Modus umschalten                | —                     |
| Super+S | `/subagents-set-model` | Rollen-Modelle der Subagenten wählen | dauerhaft gespeichert |

## Nutzerdefinierte Keybindings (keybindings.json)

| Taste         | Binding-ID               | Wirkung                         |
| ------------- | ------------------------ | ------------------------------- |
| Super+T       | `app.thinking.cycle`     | Denktiefe direkt weiterschalten |
| Super+,       | `app.model.cycleForward` | Nächstes Modell der Rotation    |
| Super+R       | `app.session.resume`     | Sitzungsauswahl öffnen          |
| Super+Shift+Y | `tui.editor.yank`        | Editor-Yank                     |

Hinweis: Super+R (Resume) und Super+S (Subagent-Modelle) sind
modifier-eindeutig getrennt; beide brauchen das erweiterte
Tastaturprotokoll des Terminals (Kitty/CSI-u).

## Workflow-Steuerung

| Taste     | Aktion                                                 | Semantik                                                                                          |
| --------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Shift+Tab | Workflow-Auswahl: Work / Schnellplan / Architekturplan | wartet auf nächste echte Nutzereingabe, startet keinen Turn (`docs/decisions/019`-Umfeld, Ledger) |

## Catalog-Shortcuts (extensions/shared/command-catalog.ts)

Zusätzlich zu den globalen Bindings trägt der Katalog:
`/resume` → Super+R. Alle übrigen Commands sind menü-/mausartig ohne
dedizierten globalen Shortcut.

## Baseline-Feststellungen für Phase 2/4

1. Shortcut → Command-Mapping existiert bereits zentral; eine GUI muss
   **dieselben Commands** (`/model`, `/thinking`, …) aufrufen können.
2. Der `effect`-Mechanik (`preserve-draft`, `starts-turn`,
   `replaces-session`) ist bei jeder GUI-Triggerung Rechnung zu tragen.
3. Offene technische Frage (Phase 3/4): Wie löst eine Electron-GUI
   Super-Kombinationen aus, ohne OS-globale Shortcuts zu registrieren?
   Konflikte sind dort zu dokumentieren.
