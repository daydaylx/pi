# Scope: CLI/TUI vs. GUI

Dieses Repo enthält zwei unabhängige Oberflächen für `pi`: die Terminal-UI
„Aurora" (CLI/TUI) und die Electron-Desktop-Oberfläche „pi gui" (GUI). Beide
sind architektonisch getrennt — Aurora hat einen eigenen State-Kanal
(`aurora-ui/state/*`), die GUI bezieht Kernzustände ausschließlich über die
Bridge/Contract-Schicht. Details zur Architektur: `gui/README.md`
(Abschnitt „Architektur") und
[`docs/decisions/007-aurora-single-ui-owner.md`](decisions/007-aurora-single-ui-owner.md).

Diese Datei ordnet Pfade eindeutig einer Seite zu, damit ein Agent bei einem
auf eine Seite beschränkten Auftrag nicht beide Bäume vollständig liest.

## Routing-Regel

- Nennt der Auftrag eindeutig **CLI**, **TUI**, **Aurora** oder **Terminal**
  → nur die CLI/TUI-Tabelle lesen. Die GUI-Tabelle bleibt außen vor.
- Nennt der Auftrag eindeutig **GUI**, **Electron**, **Desktop-Oberfläche**
  oder **„pi gui"** → nur die GUI-Tabelle lesen. Die CLI/TUI-Tabelle bleibt
  außen vor.
- Die Bridge/Contract-Tabelle wird nur zusätzlich gelesen, wenn der Auftrag
  ausdrücklich beide Seiten nennt oder explizit von „Bridge", „Protocol"
  oder „Parität" (GUI ↔ Core) spricht.

## CLI/TUI

| Pfad                                                                                                                                                                                                                 | Inhalt                                                         |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `bin/`                                                                                                                                                                                                               | Entry-Points des `pi`-Prozesses                                |
| `extensions/aurora-ui/`                                                                                                                                                                                              | Terminal-UI „Aurora" — **trotz des Namens keine Electron-GUI** |
| `extensions/ask-user.ts`, `compact-tools/`, `control-plane.ts`, `diff-viewer/`, `lsp/`, `mode-permissions.ts`, `permissions/`, `plan-mode/`, `resilience/`, `session-health/`, `setup-core/`, `shared/`, `subagent/` | übrige Core-Extensions                                         |
| `skills/`, `themes/`, `prompts/`, `schemas/`                                                                                                                                                                         | Core-Konfiguration und -Assets                                 |
| `agents/`                                                                                                                                                                                                            | Subagenten-Rollenprompts (debugger, investigator, verifier)    |
| `docs/decisions/`, `docs/subagents.md`, `docs/verify-profiles.md`, `docs/context-management.md`, `docs/runtime-matrix.md`, `docs/lsp.md`                                                                             | Core-Referenzdokumentation                                     |
| `tests/` (Top-Level-Suiten, `tests/openrouter-doctor` etc.)                                                                                                                                                          | Core-Testsuiten                                                |

## GUI

| Pfad                                                           | Inhalt                                                                                                      |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `gui/` (`main/`, `renderer/`, `shared/`, `test/`, `README.md`) | Electron-App „pi gui"                                                                                       |
| `scripts/package-gui.mjs`                                      | Packaging-Skript der GUI                                                                                    |
| `pi_gui_arbeitsauftrag/`                                       | historisches Arbeitsauftragspaket — nur bei Fragen zur Design-Historie relevant                             |
| `docs/gui-v2/`                                                 | Audit/Final-Review der GUI-v2-Überarbeitung                                                                 |
| `docs/gui-baseline/`                                           | Phase-0–8-Berichte des GUI-Arbeitsauftrags — historisch, Phase 8 laut `docs/PROJECT_STATE.md` abgeschlossen |

## Bridge/Contract (beide Seiten)

| Pfad                            | Inhalt                                                                             |
| ------------------------------- | ---------------------------------------------------------------------------------- |
| `extensions/frontend-bridge/`   | Core-Extension, die Kernzustände für die GUI aufbereitet                           |
| `extensions/frontend-protocol/` | Vertrag (Commands, Events, State-Contract, Shortcut-Mapping) zwischen Core und GUI |
| `gui/shared/shortcuts.json`     | Spiegel der Shortcut-Tabelle aus dem Protocol                                      |
