# Pi Visual System

Zielbild: ruhig · klar · agentisch · kontrollierbar · professionell.

## Chrome

- **Header:** großer ASCII-Blockbanner (`startup-banner.ts`, `ctx.ui.setHeader`) mit Farbverlauf, Byline "by Grunert" und Kurzhinweisen; skaliert je nach Terminalbreite (voll/kompakt/einzeilig). `ux-status.ts` setzt bewusst keinen eigenen Header mehr, um den Banner nicht zu überschreiben.
- **Footer:** genau eine kompakte Quelle (`ux-status.ts`, `ctx.ui.setFooter`). Die native Zentui-Statusline bleibt deaktiviert.
- **Fallback-Status:** nur ein Extension-Status-Key bleibt aktiv: `workflow-summary`. Alte Keys (`workflow-mode`, `workflow-permission`, `plan-todos-count`) werden gelöscht.

## Farben

Farben tragen Bedeutung, keine Dekoration:

| Zustand            | Farbe        |
| ------------------ | ------------ |
| Normal             | neutral      |
| Plan / Architektur | blau-violett |
| Review / Warnung   | gelb         |
| Work / Erfolg      | grün         |
| Full Access        | gelb/orange  |
| YOLO / Fehler      | rot          |

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

`full-access` und `yolo` werden nie wie normale Modi angezeigt. Beim Aktivieren erscheint ein kurzer, eindeutiger Warnblock. Der Footer färbt die Permission-Stufe entsprechend; der Header (ASCII-Banner) bleibt davon unabhängig.

## Leere Zustände

Wenn kein Plan existiert, zeigt `/status` nächste sinnvolle Schritte:

1. `/plan`
2. `/decide`
3. `/actions`
