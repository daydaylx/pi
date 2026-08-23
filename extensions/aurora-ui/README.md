# Aurora UI

Aurora UI owns Pi's footer, its transient activity widget and the working
indicator while the extension is active. It uses only public extension UI and
lifecycle hooks. Core tools are not replaced or wrapped, and the editor stays
Pi's own component: Aurora installs no editor of its own, so editing, history,
completion, shortcuts and the `editorPaddingX` / `autocompleteMaxVisible`
settings all come from the runtime (see
`docs/decisions/013-aurora-keeps-the-native-editor.md`).

The theme is `themes/aurora-night.json`. Motion is read from the effective
central setup configuration (`ui.motion`). One shared ticker runs only while
work is visible. Only real moving work animates: in `contextual`, active
thinking and running tools cycle their glyph every 100 ms, while `ANTWORTET`
and `WARTET AUF MODELL` keep a fixed glyph and repaint once per second for the
elapsed time and the `WARTET AUF MODELL` transition alone.

- `contextual`: animated activity indicator.
- `reduced`: static activity indicator.
- `off`: no animated indicator; activity text remains available.

## The two surfaces

**Footer** (`footer.ts`) — the one permanent status surface, and one line.
It shows the workflow, model, thinking level, session folder, context share and
verification state, then drops whole segments from the least important end as
the terminal narrows. The folder is derived from the session CWD captured at
session start and compacted purely; it never probes the filesystem. Risk
segments — YOLO, a failed verification, a broken language server — ignore the
width tier and are the last thing dropped. Size classes come from
`shared/layout.ts`, shared with the menu shell.

`renderFooterLines` is pure. Everything it prints was already in runtime state:
it starts no process, probes neither git nor the LSP, asks no provider and reads
no file. It is called on every frame, so anything else would be paid for
continuously.

**Activity widget** (`tool-renderers.ts`) — transient, above the editor. The
status labels, the tone mapping, the tool and subagent counts and the overflow
summary all live in `tool-renderers.ts`; `index.ts` only decides how many rows
fit and asks for the overflow line. On a
fresh empty session it briefly serves as the Aurora welcome; once a turn starts,
it carries the thinking line and only currently running work. Finished tools
leave the widget immediately rather than turning into a success block. The
welcome is never shown again within that session and is skipped for resumed
conversations.

Der Header zeigt während eines laufenden Turns `DENKT NACH` (mit Thinking-Level),
`ARBEITET`, `ANTWORTET` oder nach vier Sekunden ohne konkretes Aurora-Ereignis
`WARTET AUF MODELL`, jeweils mit einer Laufzeit. `WARTET AUF MODELL` bedeutet,
dass weder ein Tool noch ein asynchroner Subagent läuft und der Turn nur auf
die nächste Rückmeldung vom Modell/Provider wartet: Die Animation bleibt ein
Lebenszeichen, keine Hänger- oder Fehlerdiagnose, macht aber jetzt explizit,
_worauf_ gewartet wird. `idle` wird nur beim tatsächlichen Turnabschluss
(`agent_settled`) gesetzt, sofern keine asynchronen Subagenten weiterarbeiten.
`agent_end` beendet nur einen einzelnen Agentenlauf; Pi kann danach noch
automatisch retryen, kompaktieren oder einen weiteren Lauf starten.

Ein Async-Subagent, der gestartet, aber noch im Status `queued` ist, zeigt in
seiner Kachel dagegen `IM HINTERGRUND` statt `WARTET` — bewusst ein anderer
Text als der Turn-Header, da beide unterschiedliche Sachverhalte beschreiben
(Turn wartet auf das Modell vs. Subagent läuft bereits im Hintergrund) und
zuvor identische Strings die beiden leicht verwechselbar machten.

`tool_execution_start` ist Auroras einzige Quelle für eine Toolzeile. Es ordnet
die realen Laufzeitdaten als Lesen, Suchen, Bearbeiten, Shell, Testen, Prüfen,
LSP, Subagent oder Werkzeug ein; bei unbekannten Werkzeugen bleibt zusätzlich
der echte Toolname sichtbar. Kein Tool wird von der UI gewrappt oder aufgerufen. Bekannte LSP-Namen erscheinen nur als LSP-Aktivität, wenn dieses
Tool tatsächlich startet. LSP-Gesundheit bleibt eine Footer-Angelegenheit. Eine
laufende Verifikation nutzt den aktiven Kreis statt eines Erfolgs-Häkchens;
abgeschlossene Tools verschwinden aus der transienten Anzeige und Pis
Ergebnisausgabe bleibt die Quelle der Wahrheit.

Foreground subagents come from the `subagent` tool call itself. Async entries
come from the subagent package's `subagent:async-started` and
`subagent:async-complete` lifecycle events; a `subagent:control-event` can mark
a known async agent as needing attention. Aurora does not send the package's
status RPC and therefore cannot initiate a status tool call. The active
configuration keeps the Fleet Status Dock disabled, so Aurora owns the compact,
transient `SUBAGENTS · N` view without a permanent dashboard.

## UI state event contract

Import the channel and message types from `state.ts`. On every session start,
Aurora emits `aurora-ui/state/request` with a new `sessionEpoch`. Providers
answer on `aurora-ui/state/snapshot`, then publish later changes on
`aurora-ui/state/patch`. Aurora discards snapshots and patches from older
epochs. `publishAuroraUiPatch` and `publishAuroraUiSnapshot` are the typed
publisher helpers.

Cleanup on session replacement, reload and shutdown restores the core footer
and working indicator, removes the widget, unsubscribes from the event bus,
cancels any pending subagent request and stops the shared ticker.
