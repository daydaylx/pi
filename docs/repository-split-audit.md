# Repository-Split-Audit: Pi und Pi GUI

Stand: 2026-08-31  
Ausgangscommit: `6d8afc0`

## Aktuelle Architektur

Dieses Repository ist kein vollständiger Fork der Pi-Runtime. Es ist ein Setup- und
Extension-Layer um die fest gepinnte externe Runtime
`@earendil-works/pi-coding-agent@0.84.3`. Die Root-Skripte delegieren Installation,
Typecheck, Tests und Verifikation an die etablierte Abhängigkeitsgrenze `npm/`.

| Bereich                                          | Verantwortung                                                 | Kategorie    | Wichtige Abhängigkeiten und Seiteneffekte                                   |
| ------------------------------------------------ | ------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------- |
| `extensions/setup-core/`                         | Setup, Projektprüfung, Verifikationsstatus, Kontextdiagnostik | A – Core     | Runtime-Extension-API, Sessioneinträge, Prozessausführung                   |
| `extensions/permissions/`, `mode-permissions.ts` | Workflow- und Tool-Berechtigungen                             | A – Core     | Workflowzustand, Tool-Ereignisse, Dialoge                                   |
| `extensions/plan-mode/`                          | Planung, Planpräsentation und Moduswechsel                    | A – Core     | Sessionzustand, Permissions, TUI-Präsentation                               |
| `extensions/lsp/`                                | LSP-Prozesse, Dokumente und Werkzeuge                         | A – Core     | Child Processes, Workspace-Dateien, Status-Events                           |
| `extensions/diff-viewer/`                        | Change Tracking und Diff-Erzeugung                            | A – Core     | Git/Dateisystem, Sessioneinträge, TUI-Renderer                              |
| `extensions/resilience/`, `session-health/`      | Wiederherstellung und Sitzungsdiagnostik                      | A – Core     | Session- und Workflowzustand                                                |
| `extensions/subagent/`, `agents/`                | Subagent-Konfiguration und Rollen                             | A – Core     | Extern gepinntes Subagent-Paket, Permission Guards                          |
| `extensions/aurora-ui/`                          | Terminaloberfläche, Footer, Startscreen, Tooldarstellung      | B – CLI/TUI  | Konsumiert Core-Zustände; ist keine Desktop-GUI                             |
| `extensions/frontend-protocol/`                  | Interner Zustandsvertrag und Shortcut-Katalog                 | C – Contract | Importiert derzeit interne Workflow-Typen und ist nicht separat paketierbar |
| `extensions/frontend-bridge/`                    | Aggregiert Extension-Zustände als Sessioneinträge             | C – Bridge   | EventBus, Session-Persistenz, aktueller Protocol-Code                       |
| `gui/`                                           | Electron Main, Preload, Vanilla-DOM-Renderer und GUI-Tests    | D – GUI      | Startet Pi-RPC, liest zusätzlich Sessiondateien direkt                      |
| `bin/pi-gui`, `scripts/package-gui.mjs`          | Desktop-Start und Linux-Packaging                             | D – GUI      | Eingebettetes `gui/` und dessen Electron-Installation                       |
| `bin/pi`                                         | Pi-Weiterleitung und eingebetteter `pi gui`-Start             | E – gemischt | Core-CLI-Delegation plus direkte Kenntnis des GUI-Checkouts                 |
| `shared/`                                        | Workspace-Snapshot-Helfer                                     | A – Core     | Kein allgemeiner Sammelordner; aktuell eng begrenzt                         |
| `extensions/shared/`                             | Fachübergreifende Core- und TUI-Helfer                        | E – gemischt | Workflow, Permissions, Menüs, Pfade und Darstellung liegen in einer Ebene   |
| `tests/`, `benchmarks/`                          | Core/TUI-/Runtime-Prüfungen und Leistungsbaselines            | A/B          | Root-Verifikation startet derzeit auch GUI-Tests                            |

`prompts/`, `agents/`, `skills/`, `schemas/`, `settings.json`,
`keybindings.json` und `APPEND_SYSTEM.md` konfigurieren die einzige Pi-Runtime und
bleiben im Pi-Repository. Es existieren keine statisch erkennbaren lokalen
Importzyklen. Die problematische Kopplung ist eine Schichteninversion, kein
klassischer Zyklus.

## Priorisierte Probleme

### P0 – kritisch

1. Der Frontend-Contract ist kein eigenständig konsumierbares Paket. Die GUI
   verwendet weder dessen Version noch einen verbindlichen Handshake.
2. Die GUI liest Pi-Sessionverzeichnisse und interne JSONL-Einträge direkt. Damit
   besitzt sie Wissen über Core-Speicherung und Bridge-Implementierungsdetails.
3. Core-Erweiterungen beziehen neutrale Zustandshelfer teilweise über
   `extensions/aurora-ui/state.ts`. Dadurch liegt eine Core→TUI-Schichteninversion
   vor.

### P1 – wichtig

1. GUI und TUI leiten Taskstatus, Toolkategorien und Verifikationsdarstellung
   teilweise unabhängig voneinander ab; die Implementierungen können divergieren.
2. Der Bridge-Contract deckt Nachrichten, Streaming, Fehler, Konfiguration,
   Capabilities und Version-Mismatch nicht vollständig ab.
3. Die Frontend-Bridge persistiert auch ohne Desktop-Frontend Zustände in
   TUI-Sitzungen.
4. Die Root-Verifikation und mehrere GUI-Tests hängen vom gemeinsamen Checkout ab;
   beide Projekte sind nicht unabhängig baubar.
5. RPC-Parsefehler, unbekannte Events, Disconnect und Discovery besitzen noch
   keinen einheitlichen, nutzerverständlichen Fehlervertrag.

### P2 – sinnvoll

1. `gui/renderer/renderer.js`, `gui/renderer/styles.css` und
   `gui/main/ipc-handlers.js` sind groß und enthalten mehrere Verantwortlichkeiten.
   Eine Aufteilung ist nur dort nötig, wo sie die Prozess- oder Contract-Grenze
   absichert.
2. `extensions/shared/` mischt fachliche Core-Helfer und TUI-Präsentationshelfer.
   Für den Split werden nur neutral benötigte Zustandsmodule verschoben; ein breites
   kosmetisches Refactoring unterbleibt.
3. Protocol-Registries und historische GUI-Dokumente sind teilweise nur durch
   Quelltext-Paritätstests verbunden und daher driftanfällig.

### P3 – optional

1. Feature-orientierte Renderer-Unterordner können später aus den großen Dateien
   extrahiert werden.
2. macOS-/Windows-Packaging und npmjs-Veröffentlichung folgen separat.

## Fehlplatzierte Dateien und Ordner

| Datei/Ordner                                | Aktuell                    | Problem                                                    | Ziel                                                                 |
| ------------------------------------------- | -------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------- |
| `gui/`                                      | `pi`                       | Desktop-Frontend koppelt Release und Tests an Pi           | Repository `pi-gui`, unter `src/main`, `src/preload`, `src/renderer` |
| `bin/pi-gui`                                | `pi/bin`                   | Launcher kennt eingebettetes GUI-Verzeichnis               | `pi-gui/bin/pi-gui`                                                  |
| `scripts/package-gui.mjs`                   | `pi/scripts`               | Desktop-Packaging ist kein Core-Bestandteil                | `pi-gui/scripts/package-linux.mjs`                                   |
| GUI-Historien und `pi_gui_cursor_redesign/` | Pi-Dokumentation/Root      | Implementierungs- und Designhistorie des Desktop-Frontends | `pi-gui/docs/design-history/`                                        |
| `extensions/frontend-protocol/`             | interne Extension-Struktur | Nicht extern paketierbar und von Core-Typen abhängig       | `packages/frontend-protocol/`                                        |
| neutrale Publisher in `aurora-ui/state.ts`  | TUI                        | Core muss TUI importieren                                  | neutraler Contract-/Bridge-State-Bus; Aurora als Konsument           |
| Session-/Diff-Leser in GUI Main             | GUI                        | zweite Kenntnis der Pi-Speicherung                         | Pi-Frontend-Server, Zugriff über öffentliche Runtime-API             |
| Task-/Tool-Klassifizierung in GUI           | Renderer-Helfer            | doppelte Geschäftslogik                                    | autoritative Pi-Projektion im Contract                               |
| `bin/pi` GUI-Aufruf                         | Pi                         | direkte Kenntnis des eingebetteten GUI-Layouts             | dünne Discovery/Delegation zu separat installiertem `pi-gui`         |

## Abhängigkeitsgrenzen

### Ist

```text
GUI -> pi --mode rpc
GUI -> Pi-Sessiondateien und Custom-Entries
GUI -> gespiegelte Protocol-/Shortcut-Definitionen
Core -> teilweise aurora-ui/state
TUI -> Core und frontend-protocol
frontend-bridge -> interne Protocol- und Workflow-Module
Root-Verify -> Core/TUI-Tests + eingebettete GUI-Tests
```

### Soll

```text
Pi Core/Extensions -> neutraler State Bus -> Aurora TUI
Pi Core/Extensions -> Pi Frontend Server -> versioniertes JSONL-RPC
Pi GUI Main -> @daydaylx/pi-frontend-protocol -> Pi Frontend Server
Pi GUI Renderer -> validierte Preload-API
```

Unzulässig bleiben direkte GUI-Imports aus Pi-Quellpfaden, lokale
`file:../pi`-Abhängigkeiten und eigener GUI-Zugriff auf Session Storage.

## Empfohlene Zielstruktur

```text
pi/
├── bin/
│   ├── pi
│   └── pi-frontend
├── frontend-server/
├── packages/frontend-protocol/
├── extensions/
│   ├── frontend-bridge/
│   ├── aurora-ui/          # TUI
│   └── ...                 # Core-Erweiterungen
├── agents/
├── prompts/
├── skills/
├── tests/
├── benchmarks/
├── docs/
├── scripts/
└── npm/                    # bestehende Dependency-/Testgrenze

pi-gui/
├── bin/pi-gui
├── src/
│   ├── main/
│   ├── preload/
│   ├── pi-client/
│   └── renderer/
├── assets/
├── tests/
├── scripts/
├── docs/
├── package.json
└── package-lock.json
```

## Migrationsrisiken

1. Die vorhandene GUI enthält uncommittete Vorgeschichte im Ausgangsstand; sie ist
   mit Commit `6d8afc0` gesichert und muss über `git subtree split` historientreu
   extrahiert werden.
2. Ein Contract-Wechsel darf Streaming-, Extension-Dialog- und Tool-Update-Semantik
   nicht verändern. Fixtures und Adaptertests müssen vor Entfernung der alten GUI
   grün sein.
3. Der Pi-Launcher darf bei der Suche nach dem realen Pi keine Rekursion erzeugen.
4. Electron-Fehlerausgaben dürfen keine Secrets oder vollständige Runtime-stderr-
   Inhalte in den Renderer leiten.
5. Pi-GUI benötigt für reguläre Builds einen unveränderlichen Contract-Artefakt-
   Bezug; lokale Checkout-Links sind nur für Entwicklung zulässig.
6. Direkte `main`-Veröffentlichung verlangt kleine, einzeln revertierbare Commits
   und grüne Phasen-Gates; kein Big-Bang-Commit darf beide funktionierenden Pfade
   gleichzeitig entfernen.

## Abschlusskriterien Phase 1

- Relevante Repository-, GUI-, Contract-, Bridge-, Installer-, Test- und
  Packaging-Bereiche sind klassifiziert.
- GUI/Core- und Core/TUI-Kopplungen sowie Seiteneffekte sind dokumentiert.
- Fehlplatzierungen, Zielstruktur und priorisierte Risiken sind benannt.
- Bis zur Fertigstellung dieses Dokuments wurden keine Migrationsverschiebungen
  vorgenommen.
