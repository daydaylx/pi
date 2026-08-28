# Baseline-Architektur — Pi vor GUI-Einführung (Phase 0)

Stand: HEAD `459733b` nach den Vorbereitungs-Commits (`351da66` Aurora-Kachel-Paket, `459733b` Aufräum-Paket). Erhebung rein lesend.

## Startpfad von `pi`

- Binary: `/home/d/.npm-global/bin/pi` → Symlink auf
  `/home/d/.npm-global/lib/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js`
- Gemeldete Version: `pi --version` → **0.84.3**
- Das Arbeitsrepo `/home/d/.pi/agent` (Paketname `pi-agent`, internes npm-Projekt
  `pi-extensions`) enthält **keinen Core-Checkout**. „Core“ ist hier:
  1. die installierte Runtime `@earendil-works/pi-coding-agent` 0.84.3
     (devDependency in `npm/package.json`, global gepatchte Installation),
  2. die versionierten Runtime-Patches (`scripts/apply-runtime-patches.mjs`),
  3. die Extensions dieses Repos, die fachliche Zustände bereitstellen.

## Runtime-Patches (aktiv)

Laut `docs/RUNTIME_PATCHES.md`, gebunden an 0.84.3, sechs aktive Eingriffe —
angewendet sowohl auf die unbebündelten `dist/core/*`/`dist/modes/*` als auch
auf den minifizierten Bundle-Chunk:

| Patch                                           | Ziel                                         | Wirkung                                                                                                  |
| ----------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| interactive-mode submitSlashCommand             | `dist/modes/interactive/interactive-mode.js` | Extension-UI erhält programmatische Slash-Ausführung über denselben Dispatcher wie manuelle Eingabe      |
| Fokusgrenze für globale Terminal-Listener       | dito                                         | Globale Extension-Listener feuern nur bei Editorfokus; fokussierte Selector/Overlays behalten Navigation |
| package-manager Reihenfolge                     | `dist/core/package-manager.js`               | Sortierung innerhalb einer Präzedenzstufe folgt der `+path`-Reihenfolge aus `settings.json`              |
| agent-session Builtin-Import + Command-Inventar | `dist/core/agent-session.js` (+ Bundle)      | `getCommands()` liefert die Built-ins; `/commands` sieht das vollständige Inventar                       |
| compaction-failure (retired 0.84.3)             | —                                            | Upstream löst es nativ über `_emitSessionCompactFailed()`                                                |

Bewertung für die GUI: Alle aktiven Patches betreffen die interaktive
TUI-Schicht bzw. Command-Inventar/Package-Manager. Der RPC-Modus selbst war
nicht Patch-Gegenstand; der praktische Test unten bestätigt Funktion.

## CLI-Oberfläche (relevant für `pi gui`)

Aus `pi --help`: Output-Modi `--mode text|json|rpc`; Session-Optionen
(`--session`, `--resume`, `--fork`, `--session-id`, `--no-session`,
`--session-dir`); Toolsteuerung (`--tools`, `--exclude-tools`,
`--no-tools`); Modell/Denken (`--model`, `--provider`, `--thinking`,
`--models`); Extension-/Skill-/Theme-Steuerung; `--export`. Ein Subcommand
`gui` existiert nicht — `pi gui` muss als neuer Startpfad geschaffen werden
(Wrapper oder Runtime-Erweiterung; Entscheidung in Phase 2/3).

## RPC-Fähigkeiten — praktisch getestet

Protokolldoku: `docs/rpc.md` im Runtime-Paket. JSON-Zeilen auf stdin,
Ereignisse als JSON-Zeilen auf stdout; Responses tragen
`type:"response"` + optionale Korrelations-`id`.

Getestet am 2026-08-26 gegen die installierte 0.84.3:

1. **Roundtrip `get_state`**:
   ```sh
   printf '{"id":"p0-1","type":"get_state"}\n' | pi --mode rpc --no-session
   ```
   Ergebnis: `"success":true` mit vollständigem State (Modell inkl.
   Kosten/Kontextfenster, `thinkingLevel`, `sessionId`, `isStreaming`,
   `messageCount`, Compaction-Flags) **plus** gestreamte
   `extension_ui_request`-Ereignisse (z. B. `setStatus` der
   Verification-Extension, `notify`). Der RPC-Modus lädt also Extensions
   und leitet deren UI-Anfragen durch — relevant für Phase 2/3.
2. **Fehlerfall**: unbekannter Command →
   `{"id":"p0-2","type":"response","command":"nonexistent_command","success":false,"error":"Unknown command: nonexistent_command"}`
   — saubere strukturierte Fehler, kein Crash.

RPC-Command-Inventar laut Doku: `prompt`, `steer`, `follow_up`, `abort`,
`new_session`, `get_state`, `get_messages`, `set_model`, weitere
(set_* / session-Operationen). Damit sind alle Phase-3-Bedürfnisse
(Session, Prompt, Streaming, Cancel) prinzipiell abgedeckt.

## Extension-Layer des Repos

Aktive Extensions laut `settings.json` (Reihenfolge = Präzedenz):
`setup-core`, `plan-mode`, `mode-permissions`, `lsp`, `ask-user`,
`diff-viewer`, `control-plane`, `compact-tools`, `aurora-ui`, `resilience`,
`session-health`. Pakete: `pi-subagents` (gepinnt), `pi-web-access`.

Aurora-TUI liegt in `extensions/aurora-ui/` (~4.6k Zeilen): Dashboard
(auto/compact/expanded), Footer, Startbildschirm, Inspector,
Tool-Renderer mit Receipts, Task-Projektion, State-Mirror.

## Sessions und Verzeichnisse

- Session-Speicher: `~/.pi/agent/sessions/…` (projektbezogen),
  überschreibbar via `PI_CODING_AGENT_SESSION_DIR`/`--session-dir`.
- Konfigurationsverzeichnis: `~/.pi/agent` (= dieses Repo), gesteuert durch
  `PI_CODING_AGENT_DIR`.

## Bekannte Risiken für die GUI-Arbeit

- Die GUI wird sich mit einer **gepatchten Bundle-Runtime** verbinden;
  Runtime-Upgrades können RPC-relevante Bereiche verschieben
  (Upgrade-Gate `tests/p1-runtime.mjs` bleibt Pflicht).
- RPC liefert `extension_ui_request` durch: Eine GUI braucht eine
  definierte Antwort-/Ignorierstrategie dafür (Phase 2).
- Live-TTY-Smoke bleibt ohne echte Terminalsitzung unbelegt
  (`docs/manual-smoke-checklist.md`, #137); betrifft die TUI-Seite der
  Paritätstests.
