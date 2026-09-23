# Aurora UI

> **Scope:** reines Terminal-UI (CLI/TUI), nicht die Electron-GUI unter
> `gui/` — siehe `docs/scope-cli-tui-vs-gui.md`.

Aurora UI owns Pi's footer, the single framed task/activity dashboard and the
working indicator while the extension is active. It uses only public extension
UI and lifecycle hooks. Core tools are not replaced or wrapped, and the editor
stays Pi's own component: Aurora installs no editor of its own, so editing,
history, completion, shortcuts and the `editorPaddingX` /
`autocompleteMaxVisible` settings all come from the runtime (see
`docs/decisions/013-aurora-keeps-the-native-editor.md`).

`themes/aurora-forge.json` is the active warm system; `aurora-night` remains
available as the compatibility theme. Forge separates quiet UI/brand surfaces
from runtime tones. The small `visual-state.ts` mapping is the single source
for Thinking, Working, Responding, Waiting, Verification, Success, Warning,
Error and Attention tones, glyphs and motion profiles. Renderers consume that
projection instead of selecting arbitrary colours or spinners locally.

Motion and dashboard presentation come from the central setup configuration
(`ui.motion`, `ui.dashboard`). One shared ticker runs only while live work is
visible; no tool or subagent gets its own timer. `expressive` adds fast work,
a slower Waiting pulse, a quiet Responding stream and a distinct Verification
marker. `contextual` keeps only active work animated, `reduced` uses static
or reduced markers, and `off` removes time-based motion while retaining text,
glyph and colour semantics. The existing one-shot badge transition remains a
short reverse-video highlight and is disposed with the session.

- `expressive`: complete Forge motion language.
- `contextual`: restrained active-work animation.
- `reduced`: static or reduced activity markers.
- `off`: no time-based animation; activity text and glyphs remain available.

## The permanent surfaces

**Footer** (`footer.ts`) — the one permanent status surface, and one line. It
always carries the active workflow mode, including beside the dashboard,
and also reports model, thinking level, session folder, a compact changes
summary, context share and verification risks. It drops whole segments
from the least important end as the terminal narrows. From comfortable width
on, the workflow (when present) and every risk segment render as filled status
chips (pills); routine metadata stays flat so the line never turns into a wall
of colour, and narrow tiers keep the flat look entirely. Whenever a visible
panel owns verification reporting, the footer suppresses the routine successful
state; failed or stale checks remain critical footer risks at every width. The
folder is derived from the session CWD captured at session start and compacted
purely; it never probes the filesystem. Risk segments — YOLO, a failed
verification, a broken language server — ignore the width tier and are the last
thing dropped.
Size classes come from `shared/layout.ts`, shared with the menu shell.

`renderFooterLines` is pure. Everything it prints was already in runtime state:
it starts no process, probes neither git nor the LSP, asks no provider and reads
no file. It is called on every frame, so anything else would be paid for
continuously.

**Dashboard workspace** (`tool-renderers.ts`) — a single framed overview
rendered above the editor through Pi's widget slot. Auto and Expanded show a
single task/activity tile; Compact uses the flat fallback and preserves retained history rows:

- **`Aktivität`** — live activity in one tile (`buildTaskActivityTile()`). The
  redundant task title/goal row is intentionally omitted to preserve vertical
  space. While a turn is live, the tile's own heading line carries the
  detailed status and elapsed time, so its badge stays the plain `LÄUFT`
  marker; once nothing is live, the badge instead shows the settled run state
  (`VERIFIZIERT`/`ABGESCHLOSSEN`/`FEHLER`/`BEREIT`, from `header.ts`'s pure
  `sessionStatus`/`statusLabel` projections). The three most recent `READ` and
  `BEFEHL` rows remain as completed history for about 20 seconds; other
  completed tools disappear from this transient surface and remain available
  through Pi's normal result output.
- Änderungsdetails werden nicht mehr als eigene Dashboard-Kachel gezeigt;
  bei vorhandenen Änderungen erscheint stattdessen eine kompakte
  `Änderungen <Dateien> · +<hinzugefügt>/−<entfernt>`-Zusammenfassung im
  Footer. Die vollständige Liste bleibt über `/inspect` verfügbar.

There is no dedicated verification tile and no phase-chain progress bar — see
[decision 024](../../docs/decisions/024-remove-verification-tile-and-phase-chain.md).
Routine and failed verification status live in the footer and in
`/inspect`'s Verification Evidence section instead.

The single setting `ui.dashboard` in setup.json
(`auto|compact|expanded|hidden`, default `auto`) still controls the existing
`/dashboard` command and command-center entry — no new shortcut is introduced:

- **`auto`** is the responsive workspace default: the tile overview shows
  live activity in its badge and content, with an adaptive height budget.
- **`compact`** caps the workspace at two rows.
- **`expanded`** permits the task tile's optional goal within the terminal row
  budget.
- **`hidden`** hides the workspace entirely while workflow state, footer risks
  and the inspector stay alive.

Phase and verification verdict are derived separately but share one staleness
definition (`verificationIsStale()`): `done` requires idle plus a current
`READY` check, only a real running verification tool shows `Prüfen`, and active
work stays `Arbeiten` even after an earlier failed check — see
[decision 019](../../docs/decisions/019-dashboard-modes-and-phase-precedence.md).
The pure run-state projections (`sessionStatus`, `statusLabel`) live in
`header.ts`; tile/frame primitives remain in `tile.ts`; `index.ts`
derives the task and activity projection from the existing runtime state. The
welcome is never shown again within that session and is skipped for resumed
conversations.

This workspace went through a brief detour: `bd427d2` introduced the dashboard
surface, `62b52f8` added a second, permanently fixed `Sitzung` panel above it,
and `68da993` temporarily converted the workspace itself into a compact event
stream. [Decision 023](../../docs/decisions/023-single-dashboard-surface.md)
returned to a single dashboard surface — matching decision 019 — folding the
fixed panel's run-state badge into the (then still separate) activity tile
instead of keeping two framed surfaces stacked, which cost small terminals
the most space. [Decision 025](../../docs/decisions/025-merge-task-and-activity-tile.md)
later merged that activity tile into the task tile.

**Visual language** (`tile.ts`) — dashboard, welcome window and inspector
render as framed cards: title rows and body rows are padded and framed, with
explicit fills used only where a surface intentionally calls for one. Labelled
fields and status pills replace loose text. Backgrounds never use hardcoded
ANSI colours — Pi's public `Theme.bg` accepts exactly eight surfaces
(`selectedBg`, `scrollbarThumb`, `searchMatchBg`, `userMessageBg`,
`customMessageBg`, `toolPendingBg`, `toolSuccessBg`, `toolErrorBg`), and the
tile primitives map explicit tones onto them (success: `toolSuccessBg`, error:
`toolErrorBg`, accent chips: `selectedBg`, warning: inverse), so every theme
including `light` stays correct. Under 18 columns tiles fall back to frameless
rows; compact surfaces stay flat by design.

`renderTileGrid` gives every terminal cell to exactly one column, including
even widths, and `renderShortcutRows` packs complete key-cap/description units
before wrapping. These primitives use Pi's cell-aware width functions and
Aurora's ANSI-safe crop wrapper, so a resize produces either a complete row or
a deterministic wrap rather than a clipped filled cap or a one-cell edge gap.

Das Session-Panel zeigt während eines laufenden Turns `DENKT NACH` (mit
Thinking-Level im Workspace), `ARBEITET`, `ANTWORTET` oder nach vier Sekunden
ohne konkretes Aurora-Ereignis `WARTET`, jeweils mit einer Laufzeit. `WARTET`
bedeutet, dass weder ein Tool noch ein asynchroner Subagent läuft und der Turn
auf die nächste Rückmeldung vom Modell/Provider wartet. `idle` wird nur beim
tatsächlichen Turnabschluss
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
  per-file diff stats, never estimated). Drives the compact footer summary and
  the Inspector's Changes section.
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
command palette) opens Pi's native selector with six entries: Änderungen, Kontext,
Prüfnachweise, Modelle, Denken, Diagnose. Picking one
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
