# Pi Visual System

Zielbild: ruhig · klar · agentisch · kontrollierbar · professionell.

## Chrome

- **Header:** großer ASCII-Blockbanner (`startup-banner.ts`, `ctx.ui.setHeader`) mit Farbverlauf, Byline "by Grunert" und Kurzhinweisen; skaliert je nach Terminalbreite (voll/kompakt/einzeilig). `ux-status.ts` setzt bewusst keinen eigenen Header mehr, um den Banner nicht zu überschreiben.
- **Footer:** genau eine kompakte Quelle (`ux-status.ts`, `ctx.ui.setFooter`). Die native Zentui-Statusline bleibt deaktiviert. Das Footer-Format (`formatFooterLine()`) ist eine semantische Segment-Leiste: `MODE | MODEL | THINKING | PERMISSIONS | THEME | GIT | SA`; unter ca. 96 Spalten fällt `formatFooterLineCompact()` auf eine kürzere Variante zurück. Beide liefern stets Symbol/Text und sind auch ohne Farbe verständlich.
- **Fallback-Status:** zwei Extension-Status-Keys bleiben aktiv: `workflow-summary` (Mode/Model/Thinking/Git, aus `ux-status.ts`) und `permission-level` (aktuelle Zugriffsstufe, aus `mode-permissions.ts`, separat statt im Footer-String, damit `formatFooterLine()` stabil bleibt). Alte Keys (`workflow-mode`, `workflow-permission`, `plan-todos-count`) werden weiterhin gelöscht.

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

Das Theme `themes/david-dark.json` ist der ruhige, professionelle Stil. `themes/pi-vivid.json` (in `settings.json` aktiver Default für diese Konfiguration) nutzt dieselben 51 Schema-Tokens, aber gesättigtere Akzent-/Erfolgs-/Warn-/Fehlerfarben für einen lebendigeren, Crush-Lite-inspirierten Stil. Beide sind über native Theme-Discovery aktivierbar (`"theme": "pi-vivid"` bzw. `"theme": "david-dark"`). Explizite Nutzer-Theme-Konfigurationen werden nicht automatisch migriert.

`toneColor()`, `permissionTone()`, `phaseTone()` (alle in `visual-system.ts`) bilden Zustand zentral auf einen Theme-Farbnamen ab; `colorizeStatusLines()` wendet das einheitlich auf mehrzeilige Status-/Widget-Ausgaben an (erste Zeile fett+accent als Titel, weitere Zeilen per Callback getönt) und ersetzt die frühere Praxis, Farbe aus bereits gerendertem Text zu grep'en.

### InfoBox-System

`extensions/shared/info-box.ts` ist die zentrale Komponente für alle strukturierten Anzeigeboxen:

- `InfoBox` ist der theme-ungebundene Render-Kern (`render(width, theme)`, `invalidate()`, `handleInput()`).
- Einheitlicher Rahmen, Titel, optionale Sections mit Dividern, Statussymbol + Textlabel und optionaler Hintergrund.
- Unterstützt kollabierbare Boxen (default expandiert) mit `e`/`E`, Enter oder Space.
- `createInfoBoxComponent(options, theme)` liefert das eigentliche Pi-TUI-Component-Objekt (`render(width)`, `invalidate()`) und kann direkt in `renderCall`/`renderResult`, Widgets oder Overlays verwendet werden.
- `renderInfoBoxString(options, width, theme)` rendert eine Box in einen String für `ctx.ui.notify()`.
- `setSections(sections)` erlaubt dynamische Inhalte (z. B. Menüeinträge pro Render-Durchlauf).

Töne und Hintergründe sind semantisch:

| Ton         | Rahmenfarbe | typischer Hintergrund | Verwendung               |
| ----------- | ----------- | --------------------- | ------------------------ |
| `accent`    | `accent`    | `customMessageBg`     | Info-/Status-Boxen       |
| `success`   | `success`   | `toolSuccessBg`       | Erfolgreiche Tool-Boxen  |
| `warning`   | `warning`   | `toolPendingBg`       | Warnungen, laufende Tasks|
| `error`     | `error`     | `toolErrorBg`         | Fehler, harte Warnungen  |
| `neutral`   | `border`    | `customMessageBg`     | Neutrale Boxen           |
| `muted`     | `muted`     | `customMessageBg`     | Subtile Boxen            |

### Render-Profile (Glyphen, Rahmen, Fallback, Animation)

`extensions/shared/render-profile.ts` bündelt zentral, wie Zustände gerendert werden:

- `resolveRenderProfile({ env, width, mode })` entscheidet über `unicode`, `color`, `animations`, `compact`.
- Unicode-Glyphen (`● ○ ✓ ✕ ⏸ …`, Box-Drawing `╭╮╰╯│─├┤`) fallen bei `PI_ASCII_UI=1`, `TERM=dumb` oder nicht-UTF-8-Locale auf ASCII/Text zurück (`* o OK X PAUSE ...`, `+|+-+`).
- Animationen (`working-visuals.ts`) sind nur in TUI aktiv und werden bei `CI=1`, `TERM=dumb`, `PI_REDUCED_MOTION=1` oder `PI_DISABLE_ANIMATIONS=1` deaktiviert.
- Statussymbole werden **immer** als Symbol + Textlabel ausgegeben (`✓ completed`, `✕ failed`, `⏸ blocked`) — Farbe ist nie die einzige Information.
- `overlay-renderer.ts` wurde zugunsten des InfoBox-Systems entfernt. Menüs (`menu-ui.ts`) und Permission-Dialog (`permission-dialog.ts`) nutzen jetzt direkt `createInfoBoxComponent()`.

## Tool-Boxen

`extensions/tool-visuals.ts` überschreibt die Renderer für `read`, `bash`, `edit` und `write`. Jede Tool-Ausführung wird als InfoBox dargestellt:

- Titel enthält Tool-Name und Ziel/Befehl.
- Status wird als Symbol + Textlabel angezeigt (`pending`, `running`, `completed`, `failed`).
- Hintergrund und Rahmenfarbe passen sich dem Status an.
- Im expanded-Zustand zeigt die Box eine begrenzte Vorschau des Outputs (bis zu 5 Zeilen) sowie Metadaten wie Zeilenanzahl, Exit-Code oder Truncation-Hinweise.
- `renderShell: "self"` verhindert, dass Pi einen zusätzlichen Rahmen zeichnet.
- Die lokale `pi-claude-style-tools`-Package-Extension ist in `settings.json` deaktiviert (`extensions: []`), damit sie nicht dieselben Tool-Namen (`read`, `bash`, `edit`, `write`) registriert und mit `tool-visuals.ts` kollidiert.

## Theme-Erweiterungen für Boxen

`themes/pi-vivid.json` wurde um zusätzliche `vars` für Box-Hintergründe erweitert:

- `boxInfoBg` → `customMessageBg` / `toolPendingBg`
- `boxSuccessBg` → `toolSuccessBg`
- `boxWarningBg` → `export.infoBg`
- `boxErrorBg` → `toolErrorBg`
- `export.cardBg` → `boxInfoBg`

Das Theme-Schema erlaubt keine neuen `colors`-Keys (`additionalProperties: false`). Deshalb werden bestehende semantische Keys auf die neuen Vars gemappt, anstatt neue Token einzuführen.

## Menüs und Entscheidungen

`runMenu()` rendert Optionen als InfoBox mit:

- Titel
- Einträgen mit Cursor (`› `) und Auswahlmarker (`●`/`○`)
- Section-Headern für Menügruppen
- einheitlicher Bedienhilfe am unteren Rand
- kompakter Darstellung bei schmalen Terminals

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

## Permission-Dialog

Riskante Aktionen (`ask`-Entscheidungen aus `permission-policy.ts`) zeigen im TUI eine strukturierte Box (`extensions/shared/permission-dialog.ts`, `confirmAction()`), nach demselben `ctx.ui.custom()`-Overlay-Muster wie `runMenu()`:

```
╭─ Permission Request ────────────────╮
│ Tool:   bash                        │
│ Command: rm -rf build/              │
│ Risk:   hoch                        │
│ Reason: rekursives Löschen ...      │
╰──────────────────────────────────────╯
  [a] allow once  [d] deny
```

- Rahmenfarbe folgt dem Risiko: `hard: true` (harte Warnung) → rot (`error`-Ton), normales `ask` → gelb (`warning`-Ton). Ableitung über `decisionRisk()`/`riskTone()` in `visual-system.ts`, ohne `PolicyDecision` selbst zu ändern.
- Der Dialog nutzt `createInfoBoxComponent()` aus dem InfoBox-System und läuft als Overlay; Command/Ziel werden mehrzeilig gewrappt statt sicherheitsrelevant abgeschnitten. Tool, Kontext (Projektlabel), Risiko und Grund sind als eigene Sections klar getrennt; die Aktionszeile ist als eigene Section ausgeprägt (`[a] ALLOW ONCE   [d] DENY`).
- Kein `[A] allow always` — es gibt aktuell keinen Persistenzmechanismus für dauerhafte Freigaben; das wäre eine eigene, größere Änderung an `permission-policy.ts`.
- Fällt automatisch auf den klassischen `ctx.ui.confirm(title, message)`-Dialog zurück, wenn `ctx.ui.custom` nicht verfügbar ist (nicht-interaktive Kontexte, RPC-Modus, minimale Test-Mocks) oder das Overlay wirft.

## Leere Zustände

Wenn kein Plan existiert, zeigt `/status` nächste sinnvolle Schritte:

1. `/plan`
2. `/decide`
3. `/actions`
