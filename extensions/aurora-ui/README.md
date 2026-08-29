# Aurora UI

Aurora UI owns Pi's footer, its persistent session dashboard and the working
indicator while the extension is active. It uses only public extension UI and
lifecycle hooks. Core tools are not replaced or wrapped, and the editor stays
Pi's own component: Aurora installs no editor of its own, so editing, history,
completion, shortcuts and the `editorPaddingX` / `autocompleteMaxVisible`
settings all come from the runtime (see
`docs/decisions/013-aurora-keeps-the-native-editor.md`).

The theme is `themes/aurora-night.json`. Motion and the dashboard presentation
are read from the effective central setup configuration (`ui.motion`,
`ui.dashboard`). One shared ticker runs only while work is visible. Only real
moving work animates: in `contextual`, active thinking and running tools cycle
their glyph every 100 ms, while `ANTWORTET` and `WARTET AUF MODELL` keep a fixed
glyph and repaint once per second for the elapsed time and the `WARTET AUF
MODELL` transition alone.

- `contextual`: animated activity indicator.
- `reduced`: static activity indicator.
- `off`: no animated indicator; activity text remains available.

## The permanent surfaces

**Footer** (`footer.ts`) — the one permanent status surface, and one line.
It shows the workflow, model, thinking level, session folder, context share and
verification state, then drops whole segments from the least important end as
the terminal narrows. From comfortable width on, the workflow and every risk
segment render as filled status chips (pills); routine metadata stays flat so
the line never turns into a wall of colour, and narrow tiers keep the flat look
entirely. Whenever a visible dashboard surface owns verification reporting
(auto/compact/expanded), the footer suppresses the routine successful state;
failed or stale checks remain critical footer risks at every width. The folder
is derived from the session CWD captured at session start and compacted purely;
it never probes the filesystem. Risk segments — YOLO, a failed verification, a
broken language server — ignore the width tier and are the last thing dropped.
Size classes come from `shared/layout.ts`, shared with the menu shell.

`renderFooterLines` is pure. Everything it prints was already in runtime state:
it starts no process, probes neither git nor the LSP, asks no provider and reads
no file. It is called on every frame, so anything else would be paid for
continuously.

**Session dashboard** (`tool-renderers.ts`) — permanent, above the editor, with
four presentation modes owned by the single setting `ui.dashboard` in setup.json
(`auto|compact|expanded|hidden`, default `auto`), switched through `/dashboard`
which surfaces in the Super+Q command center — no new shortcut:

- **`auto`** is the responsive permanent default (`renderAutoDashboard`): after
  the fresh-session welcome it keeps a compact session card with task,
  activity, changes and verification visible, including during idle — a filled
  tile that takes the error surface when verification fails. Failed or stale
  verification appears before routine information; narrow terminals fall back
  to at most two unframed rows while keeping risks visible.
- **`compact`** caps the dashboard at two hard rows.
- **`expanded`** keeps the richer multi-tile view (Aufgabe/Aktivität/
  Änderungen/Prüfungen) within a tested height budget of roughly 40 % of
  terminal rows. From `wide` width on the tiles form a two-column card grid
  (Aufgabe + Aktivität, Änderungen + Prüfungen); a pair costs the height of
  its taller member, so the failure verdict still outranks routine tiles.
- **`hidden`** emits no dashboard at all while workflow state, footer risks and
  the inspector stay fully alive.

Phase and verification verdict are derived separately but share one staleness
definition (`verificationIsStale()`): `done` requires idle plus a current
`READY` check, only a real running verification tool shows `Prüfen`, and active
work stays `Arbeiten` even after an earlier failed check — see
[decision 019](../../docs/decisions/019-dashboard-modes-and-phase-precedence.md).
The status labels, tone mapping and tile rendering live in `tool-renderers.ts`
and `tile.ts`; `index.ts` only derives the existing runtime view model and
applies the terminal row budget. Finished tools still leave the live activity
list immediately; their real change and verification results remain visible
through the relevant session tiles. The welcome is never shown again within
that session and is skipped for resumed conversations.

**Visual language** (`tile.ts`) — dashboard, welcome window and inspector
render as filled cards: framed tiles whose title row and body rows are padded
and painted through `Theme.bg`, plus labelled fields and status pills instead
of loose text. Backgrounds never use hardcoded ANSI colours — Pi's public
`Theme.bg` accepts exactly eight surfaces (`selectedBg`, `scrollbarThumb`,
`searchMatchBg`, `userMessageBg`, `customMessageBg`, `toolPendingBg`,
`toolSuccessBg`, `toolErrorBg`), and the tile primitives map tones onto them
(neutral card: `toolPendingBg`, success: `toolSuccessBg`, error: `toolErrorBg`,
accent chips: `selectedBg`, warning: inverse), so every theme including
`light` stays correct. Under 18 columns tiles fall back to frameless rows;
compact surfaces stay flat by design.

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
configuration keeps the Fleet Status Dock disabled, so Aurora owns the compact
subagent view inside its session dashboard.

## UI state event contract

Import the channel and message types from `state.ts`. On every session start,
Aurora emits `aurora-ui/state/request` with a new `sessionEpoch`. Providers
answer on `aurora-ui/state/snapshot`, then publish later changes on
`aurora-ui/state/patch`. Aurora discards snapshots and patches from older
epochs. `publishAuroraUiPatch` and `publishAuroraUiSnapshot` are the typed
publisher helpers.

Besides `workflow`, `permissions`, `lsp`, `model` and `activity`, two owner
groups feed the task-centric view (`task-projection.ts`) and the inspector:

- `changes` — published by `extensions/diff-viewer/index.ts` after every
  recorded edit/write, aggregated straight from its `ChangeTracker` (real
  per-file diff stats, never estimated). Drives the Änderungen tile and the
  Inspector's Changes section.
- `verification` — published by `extensions/setup-core/index.ts` alongside
  its existing `ctx.ui.setStatus("verification", …)` calls. Carries the
  structured per-profile outcome (`declaredRequiredIds`, `requiredOutcomes`,
  `blockingRecommendedIds`), not just the coarse status string, so
  `projectVerificationState` can derive real checks/evidence instead of
  three hardcoded, always-`passed` criteria.

Both are `null` until their owning extension has something to report — Aurora
never fabricates a value for either.

Cleanup on session replacement, reload and shutdown restores the core footer
and working indicator, removes the widget, unsubscribes from the event bus,
cancels any pending subagent request and stops the shared ticker.

## Render diagnostics (development only)

`dev-diagnostics.ts` counts widget renders, approximates their duration,
reports the active tick interval and the last dashboard row count. It is inert
unless `PI_AURORA_DIAG=1` is set at process start; normal sessions pay nothing.
The runtime suite's `[render-measure]` line records the current cost of one full
widget frame (~0.9 ms with four active tools) — far below the 100 ms tick
budget, which is why frame caching and a slower ticker were deliberately not
built (decision 019).

## The inspector (third, on-demand surface)

`/inspect` (`inspector-command.ts`, catalogued under the `code` category, so
it surfaces through the existing Super+Q command center — no new shortcut, no
command palette) opens Pi's native selector with six entries: Changes,
Kontext, Verification Evidence, Modelle, Reasoning, Diagnostics. Picking one
renders `renderInspectorBox` (`inspector.ts`) — the one shared box shell for
secondary information — and shows it via `ctx.ui.notify`, the same
integration style `/setup-doctor context` already uses.

It reads state, never owns it: Changes and Verification reuse the same
`state.changes` / task `verification` the main view already shows; Kontext and
Diagnostics call `collectContextDiagnostics`
(`extensions/setup-core/context-diagnostics.ts`) directly, on demand only —
never from the per-frame footer/widget render path, since it walks the full
session history. The Kontext section deliberately shows only what the runtime
reports exactly (token/window counts, deterministic byte counts, compaction
timestamps, cumulative lifetime usage) and never a per-category breakdown
(conversation/files/tool results/memory): that would need a token estimate
per category the runtime cannot provide without guessing.
