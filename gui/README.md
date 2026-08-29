# Pi Desktop-GUI (GUI-Arbeitsauftrag Phase 3–8, GUI-v2)

> **Scope:** nur `gui/` + die Bridge/Contract-Schicht
> (`extensions/frontend-bridge/`, `extensions/frontend-protocol/`).
> `extensions/aurora-ui/` gehört nicht hierher — siehe
> `docs/scope-cli-tui-vs-gui.md`.

Electron-Desktop-GUI gegen den installierten, gepatchten `pi`-Prozess.
Seit der Nutzerentscheidung B (Phase 8) ist `pi gui` die bevorzugte
Oberfläche; `pi` (Aurora-TUI) bleibt vollständig erhaltener Fallback.
Seit GUI-v2 (siehe `docs/gui-v2/`) ist die Oberfläche eine eigenständige
Desktop-Coding-Agent-Oberfläche statt einer in Electron übertragenen
TUI: Chat ist die Hauptfläche mit sicherem Markdown-Rendering, Tool-
Aktivität ist sekundär, Navigation ist eine kompakte Icon-Rail, und der
rechte Bereich ist ein echter Inspector statt eines Dauer-Dashboards.

## Oberfläche (GUI-v2)

```
┌──────────────────────────────────────────────────────────────┐
│ Pi  Projekt        Work · Permission        Modell ● Status ⋯│
├──┬────────────────────────────────────────────────┬──────────┤
│  │                                                │          │
│ ⛬│              Chat (Hauptfläche, Markdown)      │ Inspector│
│ ⎇│                                                │ (kompakt,│
│ ⚇│                                                │ Detail   │
│ ✓│                                                │ auf      │
│ ⏱│                                                │ Klick)   │
├──┴────────────────────────────────────────────────┴──────────┤
│ Nachricht …                                                  │
│ [Work] [Modell] [Denken]              [Stopp] [Senden]       │
└──────────────────────────────────────────────────────────────┘
```

- **Navigation Rail** (links, 48–64px): Icons mit Tooltip statt
  Textliste; keine zweite Navigationsebene im Kontextbereich mehr.
- **Inspector** (rechts): kompakte Übersicht aus Core-State
  (frontend-bridge). Jede Zeile ist auf Abruf vertiefbar; keine
  Informationswand. Auf schmalen Fenstern wird daraus ein Drawer
  (Super+I blendet ihn ein/aus). Der Drawer-Offset folgt der
  tatsächlich gemessenen Headerhöhe (`--header-h`, per
  `ResizeObserver` synchron gehalten), nicht einer festen Pixelzahl —
  das behebt den früheren Überlapp bei umbrechendem Header.
- **Composer**: Textarea + Pill-Reihe (Workflow/Modell/Denken, alle
  mausbedienbar) + Stopp/Senden, statt reiner Textarea+Buttons.
- **Assistant-Antworten** rendern sicheres Markdown (Überschriften,
  Listen, Tabellen, Zitate, Links, Inline-Code) über
  `renderer/chat/markdown.js`; Codeblöcke sind eine eigene Komponente
  (`renderer/chat/code-block.js`) mit Sprache, Copy-Button,
  horizontalem Scrollen und einfachem Syntax-Highlighting.
- **Tool-Aktivität**: Werkzeuge erscheinen als eine kompakte
  Aktivitätszeile (`✓ 8 Reads · ● 1 Shell`); die Einzelkarten gibt es
  erst beim Aufklappen (reine `<details>`-Elemente, kein JS-State).
  Fehlgeschlagene Tools sind farblich stärker hervorgehoben.
- **Thinking** bleibt sekundär (`▸ Denken · 12s` nach Abschluss eines
  Live-Turns; historische Nachrichten zeigen `▸ Denken` ohne Dauer).

Details zu Audit, Designentscheidungen und offenen Punkten:
`docs/gui-v2/audit.md` und `docs/gui-v2/final-review.md`.

## Architektur

```
gui/
├── main/
│   ├── index.js           App-Entry: Fenster, Security-Flags, Smoke-Modus
│   ├── pi-rpc-manager.js  Ein `pi --mode rpc`-Kindprozess; JSON-Zeilen ↔
│   │                      Events; Graceful-Stop (Abort+Drain) vor stdin-Ende
│   ├── ipc-handlers.js    IPC-Whitelist inkl. Payload-Validierung
│   └── preload.cjs        contextBridge-API (window.piGui)
├── renderer/              vanilla DOM, kein Framework
│   ├── renderer.js        Zustand, Navigation, Aktivitätsgruppen, Boot
│   ├── activity-summary.js reine Verdichtung der Tool-Zeile (unit-getestet)
│   ├── interaction-helpers.js reine UI-Entscheidungshelfer (unit-getestet)
│   ├── chat/
│   │   ├── markdown.js    sicherer Markdown-Parser + DOM-Renderer (P0)
│   │   └── code-block.js  Codeblock-Komponente (Highlight, Copy)
│   ├── index.html         Nav-Rail + Chat + Inspector-Layout
│   └── styles.css         Design-Tokens, responsive (Drawer + Nav-Rail)
├── shared/shortcuts.json  Shortcut-Tabelle (Spiegel des Protokolls)
└── test/                  Unit-, Paritäts- und E2E-Smoke
```

**Core owns behavior:** Alle Zustände kommen aus dem Pi-Prozess. Die
Kernzustände (Workflow, Task, Verifikation, Änderungen, Subagenten,
Permissions, LSP) liefert die Extension `extensions/frontend-bridge/`
über gedrosselte Session-Einträge `frontend-bridge/state`. Der Renderer
hält nur Darstellungszustand. Der Contract liegt in
`extensions/frontend-protocol/`.

## Sicherheit

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`
- IPC nur über die Whitelist in `main/ipc-handlers.js`; Payloads werden
  validiert (Typen, Längen, Enum-Werte). Der Copy-Button der Codeblock-
  Komponente geht über `gui:copyToClipboard` (Electron-`clipboard`-Modul
  im Main-Prozess), nicht über die Web-Clipboard-API im Renderer.
- CSP: `default-src 'none'`, Skripte/Stile nur `self`
- Navigation und Popups sind unterbunden
- Keine Geheimnisse im Renderer; der Pi-Prozess trägt seine Auth selbst

## Starten

```sh
bin/pi-gui                    # Fenster
PATH="$PWD/bin:$PATH" pi gui  # gleiches über den pi-Shim
npm --prefix gui run smoke              # headless-Smoke (xvfb) ohne Werkzeug
xvfb-run -a bin/pi-gui --smoke-tools   # headless-Smoke mit Read-Aufruf
npm --prefix gui run smoke:dialogs      # echter Extension-Dialog + Escape ohne Modell
```

Der Smoke-Modus startet ein echtes Fenster im virtuellen Display, führt
eine echte Session durch und prüft seit Phase 6 zusätzlich, dass die
kompakte Aktivitätszeile gerendert wird. Er nutzt `--no-session` und
schreibt keine Sitzungsdaten.

## Tests

```sh
npm --prefix gui test          # Unit, Session-RPC, Shortcut-Parität, Security, Stabilität
node gui/test/e2e-rpc.mjs      # E2E gegen echtes pi (braucht Modellzugriff)
```

- `test/security.mjs`: statisches Sicherheits-Gate (Isolation, Sandbox,
  IPC-Whitelist, CSP, keine Shell-/Secret-Pfade) — reproduzierbar ohne
  Electron-Prozess.
- `test/stability.mjs`: Crash-Verhalten des RPC-Managers (Spawn-Fehler,
  Prozess-Exit während laufender Anfrage, idempotentes Stoppen).

Die E2E-Suite ist bewusst nicht Teil von `npm run verify` (echter
Modellaufruf), aber Pflicht vor jedem GUI-Release.

## Packaging (Phase 7)

Primäre Zielplattform: **Linux**. Windows/macOS erst nach Freigabe.

```sh
node scripts/package-gui.mjs      # -> dist/pi-gui-linux.tar.gz
```

Das Paket ist ein selbsttragendes Verzeichnis (gui/-Quellen +
Electron-Laufzeit + Launcher `pi-gui`) ohne Repository-Kontext; gebaut
ohne zusätzliche Abhängigkeiten. Verifiziert durch xvfb-Smokes aus dem
gepackten Launcher. `dist/` ist git-ignoriert.

## Bekannte Grenzen (R13)

- `verification.run` (direkter Anstoß): läuft heute nur agenteninvokiert
  über das `project_check`-Tool; ein Direkttrigger ist weiter Lücke.
- `super+shift+y` (Editor-Yank): TUI-editornativ, bewusst ohne
  GUI-Entsprechung.
- Super-Kombinationen können vom Linux-Fenstermanager geschluckt werden;
  deshalb versteht die GUI zusätzlich Ctrl+Alt+<Taste> als äquivalenten
  Trigger (dokumentierte Abweichung nach R5).
- Subagent-Status kennt nur queued/needs_attention/entfernt — die
  Paket-Events liefern keine feineren Lifecycle-Zustände.
- Sehr lange Chats wachsen unvirtualisiert im DOM; für Extremverläufe
  ist das ein Beobachtungspunkt (Phase-7-Report).
- Fenstergrößen jenseits der Responsive-Stufen sind nur manuell
  geprüft (xvfb deckt Logik, kein WM-Verhalten ab).
- `renderer.js` bündelt weiterhin Boot, Navigation, Picker-Dialoge und
  Ereignisverarbeitung in einer Datei. GUI-v2 hat bewusst zuerst die
  Funktions-/Visualänderungen stabilisiert (Markdown, Layout, Composer)
  und die volle Modul-Aufteilung (`app.js`/`state.js`/`events.js`/…)
  zurückgestellt, um Refactoring nicht mit Funktionsänderungen zu
  vermischen — siehe `docs/gui-v2/final-review.md`.
- Streaming-Antworten rendern Markdown bei jedem Text-Delta neu (kein
  inkrementelles Patchen des DOM-Baums). Für sehr lange Live-Antworten
  mit vielen Codeblöcken ist das ein Beobachtungspunkt, nicht optimiert.
