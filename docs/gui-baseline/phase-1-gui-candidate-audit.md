# Phase 1 – GUI-Kandidaten-Audit (Dokument 06)

Auditdatum: 2026-08-26 · Kandidaten lokal geklont nach `git/github.com/` (je 50 Commits Historie). Kandidat C (`AJSubrizi/Pi-App`) wurde nicht geklont: A und B liefern bereits zwei vollständige, unterschiedliche Architekturansätze; ein dritter Auditpfad ist nur bei begründetem Bedarf nachzuholen.

## Kandidat A — FaqFirebase/pi-desktop v0.1.6-alpha

### Architektur

| Dimension          | Befund                                                                                                                                                                            |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework          | Electron 43 + electron-vite + electron-builder                                                                                                                                    |
| React              | React 19, Tailwind 4, Zustand 5                                                                                                                                                   |
| Main/Renderer      | strikt getrennt (`src/main` ~60 Module, `src/renderer`, ein `src/preload`)                                                                                                        |
| Preload/IPC        | typisierte Channel-Verträge (`src/shared/ipc-contracts.ts`), Validierung im Preload; `contextIsolation:true`, `nodeIntegration:false`, `sandbox:true`                             |
| Pi-Anbindung       | **RPC-Prozess**: startet `<pi> --mode rpc` pro Session/Workspace (`src/main/pi-rpc-manager.ts`, Test: `buildPiArgs → ['--mode','rpc']`); Engine-Erkennung + Custom-Binary möglich |
| RPC vs. SDK        | RPC-first; spricht denselben JSON-Zeilen-Contract, den wir praktisch verifiziert haben (siehe Prototyp)                                                                           |
| Session-Verwaltung | liest `~/.pi/agent/sessions` nativ; Fork/Clone/Tree/Archive/Trash/Linage-UI über IPC                                                                                              |

### Wiederverwendbare Komponenten (Auswahl)

Chat mit Thinking-/Tool-Cards und Diff-Darstellung, Markdown+Highlighting,
Quick-Switcher (Ctrl/Cmd+K), Command-Palette mit `/`-Kommandos aus
RPC `get_commands` (unser Runtime-Patch macht Built-ins sichtbar!),
File-Tree + CodeMirror-Editor + Diff-Viewer, xterm/node-pty-Terminal,
Review-Rail (Permissions/Approvals/Changed Files), Diagnostics-Ansicht,
Theme-System, Linux-AppImage-Packaging, Extension-UI-IPC (`extension-ui-ipc.ts`)
— letzteres relevant für unsere `extension_ui_request`-Streams.

### Konflikte

- **Eigenes Permission-System (Hauptkonflikt):** vier eigene Modi
  (Plan/Read-only, Ask-before-edits, Ask-before-commands, Trusted) plus
  Glob-Regelengine, realisiert als gebündelte Pi-Extension
  (`resources/pi-desktop-permissions.ts`, env-gated) + Main-Prozess-Handler.
  Überlappt mit unserem Stack (`mode-permissions`, `permissions`,
  `ask-user`). **Mitigation:** die Extension ist eine Datei mit
  Env-Schaltern — deaktivierbar, ohne dass unser Permission-Stack leidet,
  weil A denselben Pi-Prozess mit unseren Settings fährt.
- Multi-Agent-Council (Pi+Claude+Codex-Konsensplanung): eigene
  Agentenorchestrierung, opt-in, abtrennbar.
- OMP-Engine-Abstraktion: für uns unnötig, aber harmlos.
- Keine eigene Workflow-/Verification-Wahrheit gefunden; Review-Rail zeigt
  Git-Arbeitszustand, nicht fachliche Verification.
- Modelle: editiert **unsere** `~/.pi/agent/models.json` — kein
  Duplikatkatalog.
- Upstream-Annahmen: RPC-Command-Inventar inkl. Built-ins (durch unseren
  Patch gegeben), Session-JSONL-Format kompatibel.

### Wartbarkeit

Lizenz Apache-2.0 · ~46,5k Zeilen (ohne Tests) · 85 Testdateien
(node-assert-Stil) · sehr aktiv (letzte Commits 2026-08-24) ·
offene kritische Issues: nicht verlässlich erhoben (GitHub-Issue-Seite
nicht maschinell lesbar) — bei Integrationsentscheidung nachzuholen ·
große Dependency-Fläche (CodeMirror-Sprachen, xterm, node-pty) · Status
„alpha, rough edges" im eigenen README.

## Kandidat B — minghinmatthewlam/pi-gui v0.1.0-beta.33

### Architektur

| Dimension          | Befund                                                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework          | Electron (pnpm-Monorepo: `apps/desktop`, `packages/*`)                                                                                            |
| React              | React-basiertes Desktop-App-Paket                                                                                                                 |
| State/Struktur     | saubere Pakettrennung: `session-driver`, `catalogs` (Workspace/Worktree/Session-Kataloge — UI-Buchhaltung, keine Modellkataloge), `pi-sdk-driver` |
| Preload/IPC        | IPC-Layer vorhanden (`apps/desktop/src/ipc.ts`, benannte Channels)                                                                                |
| Pi-Anbindung       | **SDK in-process**: `createAgentSessionRuntime` aus `@earendil-works/pi-coding-agent` mit NPM-Fallback                                            |
| RPC vs. SDK        | SDK-getrieben — der Agent läuft im App-Prozess                                                                                                    |
| Session-Verwaltung | „pi's own session files as the source of truth" (README)                                                                                          |

### Wiederverwendbare Komponenten

Threaded Timeline mit einklappbaren Tool-Calls, Inline-Diff-Panel, PTY-Terminal,
Worktree-per-Thread, Skills/Extensions-Verwaltung, Themes, Composer mit
@-Mentions/Bild-Attach, Playwright-E2E-Infrastruktur.

### Konflikte

- **SDK-Kopplung (Hauptkonflikt):** Pin `^0.80.6` vs. unser gepatchter
  Stand 0.84.3. Der In-Process-SDK-Lauf würde eine zweite Runtime-Wahrheit
  schaffen (Version-Drift, unsere Runtime-Patches greifen dort nicht).
  Ob SDK-Sessions unsere settings.json-Extensions laden, ist unbelegt.
  Berührt No-Go-Kriterium 7 („SDK-Schicht so eng gekoppelt, dass der eigene
  Pi praktisch ersetzt wird") — teilweise erfüllt.
- Eigenes Permission-System: nein (nur OS-Notification-Rechte).
- Eigene Workflow-/Verification-Logik: keine gefunden.
- Session-Wahrheit: kompatibel (gleiche JSONL-Dateien).
- Multi-Agent-Orchestrierung als Feature (Orchestrator/Worker-Threads):
  eigener Ansatz, kollidiert konzeptionell mit pi-subagents.

### Wartbarkeit

Lizenz MIT · ~29,8k Zeilen · 85 Test-/Spec-Dateien (Playwright E2E +
Release-Helfer) · letzte Commits 2026-07-28 (rund einen Monat vor Audit)
· macOS-first poliert, Linux-AppImage vorhanden · Issue-Lage ebenfalls
nicht verlässlich erhoben.

## Pflicht-Prototyp gegen daydaylx/pi

A favorisiert; sein Verbindungscontract (`pi --mode rpc`, JSON-Zeilen)
wurde direkt gegen unsere installierte, gepatchte Runtime gefahren —
ohne Electron, dafür exakt auf der Schicht, die A benutzt:

| Prüfpunkt            | Ergebnis                                                     |
| -------------------- | ------------------------------------------------------------ |
| Prozessstart         | ✔ (`--mode rpc --no-session`, Exit 0)                        |
| Sessionstart / State | ✔ `get_state` → success, vollständiger Core-State            |
| Prompt               | ✔ accepted (`success:true`)                                  |
| Streaming            | ✔ 25× `message_update`                                       |
| Tool-Event           | ✔ `tool_execution_start/end` (read)                          |
| Agent-Ende           | ✔ `agent_end` + `agent_settled`; Antwort exakt „BASELINE-OK" |
| Fehler               | ✔ unbekannter Command → strukturierte `success:false`        |
| Stop/Cancel          | ✔ `abort` → `success:true`; Turn bricht ab                   |

Evidenz: `docs/gui-baseline/rpc-prototype-evidence.jsonl` (Abort-Fall) und
`rpc-prototype-complete.jsonl` (Komplettlauf).

**Befunde für Phase 2/3:**

1. Normaler Turn läuft komplett fehlerfrei durch — **keine**
   Extension-Fehler im Komplettlauf.
2. Harter Shutdown während eines aktiven Turns (stdin-EOF bzw. Abort
   früh im Turn) löst stale-ctx-Fehler in `setup-core`, `plan-mode`,
   `resilience` bei `agent_settled` aus (Testmatrix-Fall D „GUI wird
   während aktivem Turn geschlossen"). Work item, kein Blocker.
3. RPC leitet `extension_ui_request` durch — die GUI braucht eine
   Antwortstrategie (A hat dafür bereits `extension-ui-ipc.ts`).

## No-Go-Prüfung (Dokument 04)

| Kriterium                      | A                                  | B                              |
| ------------------------------ | ---------------------------------- | ------------------------------ |
| 1 Core-Umschreibung nötig      | nein                               | nein                           |
| 2 Extensions grundsätzlich tot | nein                               | ungeklärt/unwahrscheinlich     |
| 3 Modell-/Provider doppelt     | nein (editiert unsere models.json) | nein (nutzt Pi-Auth)           |
| 4 Sessions inkompatibel        | nein                               | nein                           |
| 5 Permission dupliziert        | **teilweise, mitigierbar**         | nein                           |
| 6 Verification im Frontend     | nein                               | nein                           |
| 7 Kopplung ersetzt eigenen Pi  | nein (RPC an eigenen Prozess)      | **teilweise (In-Process-SDK)** |
| 8 Lizenz blockiert             | nein (Apache-2.0)                  | nein (MIT)                     |
| 9 Instabilität                 | alpha, aber aktiv+getestet         | beta, ruhender                 |

## Empfehlung: **Kandidat A (pi-desktop)**

Begründung: A ist der einzige Kandidat, dessen Anbindungsmodell (externer
RPC-Prozess) unsere Schutzregeln R1/R2/R10 nativ erfüllt — derselbe
gepatchte Pi-Prozess, dieselben Extensions, dieselben Sessions, dieselbe
models.json. Der Prototyp belegt genau diese Schicht end-to-end. Die
Konflikte (Permission-Rule-Engine, Council) sind datei-isoliert abschaltbar.
Die Funktionsfläche deckt Phasen 3–6 breit ab (Tool-Cards, Diff, Terminal,
Review-Rail, Themes, Packaging).

Gegenargumente (bewusst genannt): Alpha-Status und große
Dependency-Fläche bedeuten Realisierungsrisiko; die Permission-Dopplung
muss aktiv entschieden werden (Vorschlag: deren Extension nicht laden,
unser Stack bleibt maßgeblich; deren Rule-Engine höchstens später als
Zusatz diskutieren); OMP-Abstraktion ist Ballast, den wir ignorieren.

Warum nicht B: Der In-Process-SDK-Pfad mit Version-Pin 0.80.6 schafft
exakt die zweite Wahrheit, die R2/R10 und No-Go 7 vermeiden wollen, und
die Extension-Parität unter dem SDK ist unbelegt. B bleibt als
Architekturreferenz (Session-Driver-Trennung, Playwright-E2E) wertvoll.

Warum nicht Eigenbau: Der Wiederverwendungsanteil von A (Chat/Diff/Terminal/
IPC-Sicherheit/Packaging ≈ der Großteil von Phase 3–4) übersteigt den
Anpassungsaufwand (Permission-Extension entfernen, Aurora-State-Kanäle
anbinden) deutlich.
