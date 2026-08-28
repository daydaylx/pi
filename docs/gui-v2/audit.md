# GUI-v2 Audit (Phase 0)

Datum: 2026-08-28 · Grundlage: `gui/renderer/index.html`, `gui/renderer/styles.css`,
`gui/renderer/renderer.js`, `gui/renderer/activity-summary.js`,
`gui/renderer/interaction-helpers.js`, `gui/main/*`, `gui/test/*`, `gui/shared/shortcuts.json`.

Dies ist kein Architektur-Audit (das existiert bereits unter
`docs/gui-baseline/phase-1-gui-candidate-audit.md` und begründet die
RPC-Anbindung). Dieses Dokument bewertet ausschließlich die **visuelle und
interaktive** Umsetzung der bestehenden Electron-GUI, wie vom Arbeitsauftrag
"Pi Desktop-GUI zu einer echten Coding-Agent-Oberfläche weiterentwickeln"
gefordert.

## 1. Aktuelle Layoutstruktur

Drei-Spalten-CSS-Grid (`#layout { grid-template-columns: 150px minmax(0,1fr) 300px }`):

- **Links** `#side-nav` — 150px breite Textliste (`Chat / Änderungen / Agenten
  / Verifikation / Sitzungen`), volle Wortlabels, keine Icons.
- **Mitte** `#conversation` — Chat + Composer.
- **Rechts** `#context-area` — 300px breite Übersicht (`#context-overview`)
  mit Klick-Zeilen, die in ein Detail-Panel (`#context-panel`) umschalten
  (kein Split-Screen, ein Bereich verdrängt den anderen vollständig).

Kopfzeile `#status-bar` (42px, `--header-h`) enthält in einer Reihe: Marke,
Projektname, Workflow-Chip, Permission-Chip, Spacer, Status-Punkt,
Status-Text, Modell-Label, Denk-Label, 4 Buttons (Modell, Denken, Befehle,
Neu) — 10 nebeneinander liegende Informationsträger auf 42px Höhe.

## 2. Redundante UI-Flächen

- **Workflow** erscheint dreifach: als Chip im Header (`#workflow-label`),
  als Zeile in der Kontext-Übersicht (`Aufgabe`-Zeile fehlt eigentlich,
  aber `Workflow`-Zeile existiert und öffnet den gleichen Picker), und
  implizit nochmal im Verifikations-Panel.
- **Modell/Denken** erscheinen doppelt: als Header-Label + Header-Button
  UND als Zeile "Modell" in der Kontext-Übersicht (nur Anzeige, kein Link).
- **Navigation vs. Kontext-Übersicht**: `#side-nav` (Chat/Änderungen/
  Agenten/Verifikation/Sitzungen) und die klickbaren Zeilen in
  `#context-rows` (Aufgabe/Workflow/Verifikation/Änderungen/Agenten/
  Kontext/Modell) bilden zwei sich überschneidende Navigationsebenen zum
  selben Ziel (z. B. "Änderungen" ist über Nav-Button UND Kontext-Zeile
  erreichbar). Der Arbeitsauftrag verlangt genau das zu entfernen (§6/§7).
- Der rechte Bereich ist **immer ein Vollbild-Dashboard** (Übersicht oder
  Panel), nie eine kompakte Randspalte — er konkurriert dauerhaft mit dem
  Chat um Aufmerksamkeit statt nur bei Bedarf Details zu liefern.

## 3. Terminal-/TUI-Muster

- **Globale Monospace-Typografie**: `body { font: 14px/1.45 "JetBrains
  Mono", "Cascadia Code", monospace, sans-serif }` — jede UI-Fläche (Header,
  Navigation, Buttons, Chat-Bubbles, Dialoge) läuft über dieselbe
  Terminalschrift. Es gibt keine Trennung UI-Schrift vs. Code-Schrift.
- **Assistant-Antworten sind Plaintext**: `setAssistantText` setzt
  `block.bubble.textContent = text` — kein Markdown-Rendering, keine
  Codeblock-Komponente, keine Tabellen/Listen-Darstellung. Jede
  Markdown-Antwort des Modells erscheint als Rohtext mit sichtbaren `#`,
  `**`, `` ``` `` usw. Das ist der größte Einzelbefund (P0 im
  Arbeitsauftrag).
- **Tool-Ausgaben und Denken** laufen über `<pre>`/`<details>` mit
  Monospace und Terminal-Symbolen (`▸`/`▾`/`●`/`✓`/`✗`) — für technische
  Inhalte grundsätzlich richtig (Tool-Output/Diffs sollen Monospace
  bleiben), aber die gleiche Symbolik/Optik zieht sich in den Header
  (Status-Punkt als reiner Farbklecks) und in die Kontext-Zeilen.
- **Farbpalette** ist ein klassisches Terminal-Dunkelschema
  (`--bg:#14161a`, `--surface:#1c1f25`, kaum Abstufung, harte 1px-Ränder
  überall: Header, Nav, Kontext, jede Card, jeder Button) — viele Rahmen,
  keine Elevation/Spacing-Hierarchie.
- **Statuszeile wirkt wie ein Dashboard**: Workflow-Chip, Permission-Chip,
  Status-Punkt, Status-Text, Modell-Label und Denk-Label sind alle
  permanent sichtbar, unabhängig davon ob sie gerade relevant sind.

## 4. Informationshierarchie

- Chat-Fläche hat keine Breitenbegrenzung außer `max-width: 88ch` je
  Bubble, aber keine gezielte Formatierung, die Lesbarkeit für Prosa
  fördert (kein Zeilenlängen-Komfort für UI-Schrift, keine Absatzabstände
  jenseits von `white-space: pre-wrap`).
- Tool-Aktivität ist bereits **kompakt zusammengefasst**
  (`activity-summary.js` → `✓ 8 Reads · ✓ 2 Edits · ● 1 Shell`) — dieser
  Teil erfüllt §11 des Arbeitsauftrags bereits weitgehend und sollte
  erhalten bleiben, nur visuell integriert werden (weniger Monospace/
  Rahmen).
- Thinking ist bereits als `<details>` versteckt (§12 teilweise erfüllt),
  zeigt aber keine Dauer ("▸ Thinking · 12 s" gefordert) und nutzt die
  gleiche Rahmenoptik wie Tool-Cards.
- Fehlgeschlagene Tools sind nur durch ein `✗`-Suffix im Summary-Text
  hervorgehoben, keine echte visuelle Eskalation (Farbe der Card-Border,
  Position).

## 5. Renderer-Verantwortlichkeiten

`gui/renderer/renderer.js` (1362 Zeilen) bündelt aktuell:

- Zustandshaltung (`state`, `WORKFLOW_MODES`)
- Chat-Rendering (User/Assistant-Bubbles, Streaming-Deltas)
- Tool-Aktivitätsgruppen (DOM-Erzeugung + Zusammenfassung)
- Extension-UI-Dialoge (`select`/`confirm`/`input`, generischer
  `dialogShell`)
- Picker-Infrastruktur (Modell/Denken/Workflow/Befehle/Sitzungen)
- Navigation + Kontextbereich (Übersicht + Detail-Panels für
  Changes/Agents/Verify/Sessions)
- Status-/Verbindungs-Handling (`applyRuntimeState`, `refreshStatusBar`,
  Session-Wechsel/-Neustart)
- Shortcut-Dispatch (`actions`-Tabelle + `setupShortcuts`)
- Boot-Sequenz und der Headless-Smoke-Hook (`window.__piGuiSmoke`)

Das ist eine einzige Datei für praktisch die gesamte GUI-Logik — klar zu
groß und deckt sich mit dem im Auftrag benannten Problem (§17/Phase 6).
`activity-summary.js` und `interaction-helpers.js` sind bereits saubere,
DOM-freie Hilfsmodule (gutes Vorbild für die Zielstruktur).

**Zustandsgrenze ist sauber**: Der Renderer hält ausschließlich
Präsentationszustand (`state.core` wird 1:1 aus `frontend-bridge/state`-
Custom-Entries übernommen, keine eigene Workflow-/Verification-/
Permission-Logik). Diese Grenze muss bei jedem Umbau erhalten bleiben.

## 6. Bekannte Responsive-Probleme

- `@media (max-width: 1080px)`: `#context-area` wird `position: fixed; top:
  var(--header-h)`. `--header-h` ist eine **feste** Konstante (42px), aber
  ab `@media (max-width: 760px)` bekommt `#status-bar` `height: auto;
  flex-wrap: wrap` — der Header kann dadurch mehrzeilig werden und höher
  als 42px sein. Der Drawer beginnt dann zu hoch (überlappt den
  umgebrochenen Header) bzw. lässt eine Lücke, je nach tatsächlicher
  Headerhöhe. Das ist exakt der im Auftrag (§16) benannte Fehler.
- `#side-nav` schrumpft bei ≤760px auf 46px mit `font-size: 0` +
  `::first-letter` — ein CSS-Trick, der bei mehrsprachigen/langen Labels
  fragil ist und keine echten Icons nutzt.
- Kein getesteter Zustand für 800×700 oder 640×600 dokumentiert; nur die
  Breakpoints 1080px/760px existieren, keine Prüfung der Composer- oder
  Dialogbreite bei sehr kleinen Fenstern unterhalb 640px.
- Dialoge (`dialog { width: min(620px, calc(100vw - 32px)) }`) sind bereits
  responsiv breitenbegrenzt — das funktioniert und sollte erhalten
  bleiben.

## 7. Was bleibt (bewusst nicht anfassen)

- RPC-Anbindung, `pi-rpc-manager.js`, `ipc-handlers.js`, `preload.cjs`:
  Sicherheitsmodell (`contextIsolation`, `sandbox`, `nodeIntegration:false`,
  IPC-Whitelist, CSP) ist bereits vorbildlich und wird durch
  `gui/test/security.mjs` erzwungen — keine Änderung geplant.
- `frontend-bridge/state`-Contract und Core-Autorität (`state.core`) bleiben
  unverändert.
- Kompakte Tool-Aktivitätszusammenfassung (`activity-summary.js`) bleibt
  als Konzept erhalten, wird nur visuell neu eingebettet.
- Alle bestehenden Shortcuts (`gui/shared/shortcuts.json`) bleiben 1:1
  erhalten; `shortcut-parity.mjs` erzwingt Gleichheit mit
  `extensions/frontend-protocol/shortcut-mapping.ts`.

## 8. Ableitung für die Umsetzung

Priorität P0 laut Auftrag — Markdown-Rendering — ist der größte Einzelbefund
und wird zuerst sicher (ohne `innerHTML` auf Modelltext) umgesetzt. Danach:
Layout (Nav-Rail, echter Inspector, Header-Vereinfachung), Composer,
Responsive-Fix (`--header-h` darf nicht mehr als feste Pixelgröße für den
Drawer-Offset dienen, wenn der Header wachsen kann), und zuletzt —
getrennt von Funktionsänderungen — die Modularisierung von `renderer.js`.
