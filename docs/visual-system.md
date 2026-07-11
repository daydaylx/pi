# Pi Visual System

Zielbild: ruhig · klar · agentisch · kontrollierbar · professionell.

## Chrome

- **Header:** Der ASCII-Blockbanner erscheint nur beim Start und klappt mit der ersten Eingabe auf `PI AGENT · <Modell>` ein. `/banner on|compact|off` steuert ihn für die aktuelle Sitzung; Modellwechsel aktualisieren die kompakte Zeile.
- **Footer:** `ux-status.ts` ist die einzige dauerhafte TUI-Statusquelle. Die einzeln gefärbten Segmente stehen in der Reihenfolge `MODUS · MODELL · FEHLER/WARNUNG · SA · RECHTE · GIT · DENKEN`; bei Platzmangel verschwinden optionale Metadaten zuerst. Theme, Anbieter und Projektpfad stehen nur in `/status`.
- **Fallback-Status:** `workflow-summary` wird nur verwendet, wenn kein TUI-Footer verfügbar ist. Alte Extension-Status-Keys werden gelöscht; Zentui besitzt dafür keine sichtbaren Platzierungen mehr.

## Anzeigeprofile

`settings.json` enthält eine zentrale `ui`-Konfiguration. `balanced` ist der Standard, `minimal` reduziert Banner und Live-Widgets, `debug` zeigt zusätzliche Diagnosefelder. Feldweise Overrides sind möglich; Laufzeitbefehle ändern die Datei nicht.

- `banner`: `on | compact | off`
- `activity`: `auto | on | compact | off | debug`
- `subagentWidget`: `active-only | on | off | compact | debug`
- `toolHistory`: `compact | full`
- `footer`: `priority | full`
- `language`: aktuell `de`
- `reducedMotion`: deaktiviert Animationen unabhängig von Terminalfähigkeiten

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
- Die Farbstufe wird konservativ aus TTY, `TERM`, `COLORTERM`, `NO_COLOR`, `CLICOLOR` und Force-Flags ermittelt.
- Unicode-Glyphen (`● ○ ✓ ✕ ⏸ …`, Box-Drawing `╭╮╰╯│─├┤`) fallen bei `PI_ASCII_UI=1`, `TERM=dumb` oder nicht-UTF-8-Locale auf ASCII/Text zurück (`* o OK X PAUSE ...`, `+|+-+`).
- Animationen (`working-visuals.ts`) sind nur in TUI aktiv und werden bei `CI=1`, `TERM=dumb`, `PI_REDUCED_MOTION=1` oder `PI_DISABLE_ANIMATIONS=1` deaktiviert.
- Statussymbole werden **immer** als Symbol + Textlabel ausgegeben (`✓ completed`, `✕ failed`, `⏸ blocked`) — Farbe ist nie die einzige Information.
- `overlay-renderer.ts` wurde zugunsten des InfoBox-Systems entfernt. Menüs (`menu-ui.ts`) und Permission-Dialog (`permission-dialog.ts`) nutzen jetzt direkt `createInfoBoxComponent()`.

## Tool-Boxen

`extensions/tool-visuals.ts` überschreibt die Renderer für `read`, `bash`, `edit` und `write`. Jede Tool-Ausführung hinterlässt unabhängig von der Terminalbreite mindestens eine kompakte Verlaufsspur:

- Titel enthält Tool-Name und Ziel/Befehl.
- Status wird als Symbol + Textlabel angezeigt (`pending`, `running`, `completed`, `failed`).
- Hintergrund und Rahmenfarbe passen sich dem Status an.
- Fehler öffnen die Box automatisch und zeigen Exit-Code sowie die erste relevante Ursache. Im expanded-Zustand zeigt die Box eine begrenzte Vorschau des Outputs sowie Metadaten.
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
- Viewport mit sichtbarer Auswahl, Restindikatoren sowie `PgUp`, `PgDn`, `Home` und `End`
- kompakter Darstellung unter 60 Spalten, mittlerer Darstellung bis 89 und ausführlicher Darstellung ab 90 Spalten
- inhaltsabhängiger Breite zwischen 42 Spalten und 75 Prozent des Terminals

`/actions` öffnet das zentrale Aktionsmenü. Slash-Commands bleiben direkt nutzbar.

## Plan und Work

- Planstatus kommt aus `plan-mode` als strukturiertes Event.
- Work-Fortschritt erscheint während `executing` als Widget `work-progress`:
  - `○` offen
  - `…` läuft
  - `✓` erledigt
  - `!` blockiert
  - `×` fehlgeschlagen
- Das Widget zeigt höchstens den letzten erledigten, aktuellen und nächsten Schritt sowie `+ N weitere`; `/plan-todos` bleibt vollständig.
- Die Plan-Datei bleibt ausführlich; UI-Ausgaben sind kompakt und handlungsorientiert.

## Aktivität und Subagenten

`activity-panel.ts` verwendet kein Overlay. `/activity` zeigt ein normales, nicht überlagerndes Widget; im Modus `auto` nur während echter Aktivität. Der Tool-Verlauf bleibt immer im Haupttranskript.

Das Subagenten-Widget läuft standardmäßig als `active-only`: Leerlauf und abgeschlossene Läufe belegen keinen Platz. Warnungen, blockierte und fehlgeschlagene Läufe bleiben sichtbar; Debug zeigt zusätzlich Aufgabe, letzte Aktion, Laufzeit und Zähler.

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
