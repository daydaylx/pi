# Pi Visual System

Zielbild: ruhig · klar · agentisch · kontrollierbar · professionell.

## Chrome

- **Header:** genau eine kompakte Quelle (`ux-status.ts`, `ctx.ui.setHeader`) mit maximal zwei Zeilen:
  - `PI · <Projekt>`
  - `<MODE · PHASE> | <Model> | <Thinking> | <Permission>`
- **Footer:** genau eine kompakte Quelle (`ux-status.ts`, `ctx.ui.setFooter`). Der alte große Startup-Banner und Zentui-Statusline sind deaktiviert.
- **Fallback-Status:** nur ein Extension-Status-Key bleibt aktiv: `workflow-summary`. Alte Keys (`workflow-mode`, `workflow-permission`, `plan-todos-count`) werden gelöscht.

## Farben

Farben tragen Bedeutung, keine Dekoration:

| Zustand | Farbe |
| --- | --- |
| Normal | neutral |
| Plan / Architektur | blau-violett |
| Review / Warnung | gelb |
| Work / Erfolg | grün |
| Full Access | gelb/orange |
| YOLO / Fehler | rot |

Das Theme `themes/david-dark.json` nutzt gedämpfte Farben, dunkle Borders und gedimmte Tool-Ausgaben.

## Menüs und Entscheidungen

`runMenu()` rendert Optionen als ruhige Karten mit:

- Name
- kurze Beschreibung
- aktuelle Auswahl (`●`) vs. Alternative (`○`)
- einheitliche Bedienhilfe am Ende

`/actions` öffnet das zentrale Aktionsmenü. Slash-Commands bleiben direkt nutzbar.

## Plan und Work

- Planstatus kommt aus `plan-mode` als strukturiertes Event.
- Work-Fortschritt erscheint während `executing` als Widget `work-progress`:
  - `○` offen
  - `…` läuft
  - `✓` erledigt
  - `!` blockiert
  - `×` fehlgeschlagen
- Die Plan-Datei bleibt ausführlich; UI-Ausgaben sind kompakt und handlungsorientiert.

## Warnzustände

`full-access` und `yolo` werden nie wie normale Modi angezeigt. Beim Aktivieren erscheint ein kurzer, eindeutiger Warnblock. Header/Footer färben die Permission-Stufe entsprechend.

## Leere Zustände

Wenn kein Plan existiert, zeigt `/status` nächste sinnvolle Schritte:

1. `/plan`
2. `/decide`
3. `/actions`
