# Phase 3 – Abschlussreport: Minimal-GUI

## Status

- Phase: 3
- Ergebnis: PASS
- Nächste Phase: 4 — vom Nutzer vorab freigegeben („go phase 3 und 4“)

## Umsetzungspfad (Nutzerentscheidung im Dialog)

Der Audit empfahl Kandidat A als Basis. Vor Phase-3-Start wurde die
Weichenstellung dem Nutzer vorgelegt (Xvfb verfügbar, beide Pfade
grundsätzlich machbar): **Entscheidung = Eigenbau-Minimal-Shell**.
pi-desktop bleibt geklont als Komponenten-/UX-Referenz für Phase 5/6.

## Umgesetzt

- Neue Electron-Minimal-GUI unter `gui/` (~1.100 Zeilen, null Runtime-
  Dependencies außer electron@44):
  - `main/index.js`: Fenster mit härtesten Security-Flags; Smoke-Modus.
  - `main/pi-rpc-manager.js`: verwaltet genau einen `pi --mode rpc`
    Kindprozess (ID-Korrelation, Zeilenpuffer, parse-error statt Crash,
    stderr-Ring, sauberes Stop mit SIGTERM→SIGKILL). Frei von Electron-APIs.
  - `main/ipc-handlers.js`: IPC-Whitelist mit Payload-Validierung (Typen,
    Längen, Enums); Extension-UI-Antworten strikt auf dokumentierte Formen.
  - `main/preload.cjs`: schmale `window.piGui`-Bridge (contextBridge).
  - `renderer/`: Chat-Oberfläche — Streaming (text_delta-Akkumulation,
    autoritative message_end), kompakte Tool-Cards mit aufklappbaren
    Details (R8), Cancel-Button, Fehlerbanner, Neue-Sitzung, Statusleiste
    (Verbindung/Modell/Denktiefe), Inspector-Panel.
  - Session-Resume: Verzeichnisliste (mtime-absteigend, max. 20) +
    `switch_session`; Extension-Selector (/permission, /subagents-set-model)
    werden als native Dialoge gerendert und beantwortet.
- `bin/pi-gui` Launcher + `bin/pi` Shim: `pi gui` startet die GUI,
  alles andere geht an das echte pi (0.84.3 bestätigt).
- `.gitignore`: Build-Artefakte der GUI ausgeschlossen.
- Format-Gate `gui/test/format-check.mjs` (Prettier-API, Repo-Konfiguration).

## Tests

- Bridge-E2E gegen echtes Pi (`node gui/test/e2e-rpc.mjs`): **PASS** —
  Session-ID, Streaming, tool_execution_start/end, „BASELINE-OK“,
  Abort-Pfad, danach weiter bedienbar, sauberes Beenden.
- GUI-Smoke unter Xvfb (`--smoke`): **SMOKE PASS** — echtes Fenster,
  Preload-Bridge, Renderer-Logik, SMOKE-OK.
- GUI-Smoke mit Werkzeug (`--smoke-tools`): **SMOKE PASS** — zusätzlich
  tool_execution_start + BASELINE-OK.
- Unit-Tests: 6 PASS; Shortcut-Parität: 4 PASS.
- Kanonisch: `project_check({profile:"verify"})` Exit 0, 1/1; TUI-Suiten
  unverändert grün (Runtime 1307, UI 124).

## Abschlusskriterien (Dokument 08)

- [x] `pi` startet weiterhin TUI (nicht angerührt; Suiten grün)
- [x] `pi gui` startet GUI (Shim + Launcher unter Xvfb belegt)
- [x] echte Pi-Session funktioniert
- [x] Streaming zuverlässig
- [x] Tool-Start/-Ende korrekt dargestellt
- [x] Cancel funktioniert
- [x] Fehler sind sichtbar (Banner, extension_error-Behandlung)
- [x] Renderer hat keinen freien Node-Zugriff (sandbox + validated IPC)
- [x] kein fachlicher State dupliziert (nur Live-Daten + Darstellungszustand)
- [x] mindestens ein End-to-End-Smoke-Test existiert (drei Varianten)
- [x] GUI-Beende ohne Schaden an Sessiondaten (sauberes SIGTERM nach
      stdin-Ende; Daten gehören dem Pi-Prozess)

## Abweichungen (dokumentiert, R13/R5-konform)

- Eigenbau statt pi-desktop-Fork: Nutzerentscheidung (Dialog), Begründung:
  exakte Scope-Passung, volle Testbarkeit in dieser Umgebung, kleiner Rollback.
- Renderer ohne React-Framework (vanilla DOM): minimale auditierbare Fläche;
  React bleibt für Phase 6 offen, wenn Komponentenumfang es rechtfertigt.
- `pi gui` ist ein Shim (interceptiert nur das Wort „gui“); ein echter
  CLI-Unterstützungspunkt bräuchte einen Runtime-Patch — bewusst vermieden.

## Risiken

- Stale-ctx-Fehler bei hartem Shutdown im aktiven Turn (aus Phase 1 bekannt)
  betrifft auch den GUI-Fall „Fenster schließt während des Turnens“ —
  Pflichtfix vor Phase-5-Divergenztests.
- Super-Tasten können vom Linux-WM geschluckt sein → Ctrl+Alt-Alternativen
  und Mauspfade vorhanden; reale WM-Vielfalt ist manuell zu prüfen.
- Alpha-artige Randfälle der RPC-Ergebnisformen (z. B. toolCall-Argumente)
  sind defensiv geparsed, aber nur gegen die Doku getestet.

## Technische Schulden

- gui/node_modules (electron ~44) uncommitted und groß; nur Quelltext
  gehört ins Repository (gitignore erledigt).
- Inspector zeigt Workflow/Task/Subagenten als Platzhalter (Phase 5).
- Kein Autostart-Reconnect nach Pi-Crash (manuell „Neue Sitzung“).

## Geänderte Dateien

- neu: `gui/**` (Main, Renderer, Shared, Tests, README), `bin/pi`,
  `bin/pi-gui`
- geändert: `.gitignore`

## Rollback

- `rm -r gui bin/pi bin/pi-gui` + `.gitignore`-Einträge entfernen.
  Runtime, Extensions, Settings, Sessions bleiben unberührt.

## Empfehlung

- GO für Phase 4 (bereits freigegeben).

## Harte Sperre

Phase 4 läuft auf Grundlage der Nutzerfreigabe. **Phase 5 ist danach
blockiert.**
