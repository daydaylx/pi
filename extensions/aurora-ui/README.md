# Aurora UI

Aurora UI owns Pi's footer, its transient activity widget and the working
indicator while the extension is active. It uses only the public extension UI
and lifecycle hooks. Core tools are not replaced or wrapped, and the editor is
Pi's own — Aurora installs no editor component.

The theme is `themes/aurora-night.json`. Motion is read from the effective
central setup configuration (`ui.motion`):

- `contextual`: one shared 100 ms ticker runs only while work is visible.
- `reduced`: static activity indicator; no extension ticker.
- `off`: no animated/working indicator; activity text remains available.

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

**Activity widget** (`tool-renderers.ts`) — transient, above the editor. On a
fresh empty session it briefly serves as the Aurora welcome; once a turn starts,
it carries the thinking line, running tools and current subagents. Finished work
leaves the widget rather than turning into a success block. The welcome is never
shown again within that session and is skipped for resumed conversations.

Subagent status is the one thing Aurora cannot read directly. Foreground runs
come off the `subagent` tool call itself; async runs need a request to the
subagent package, and that request is triggered by `subagent:control-event`
alone, never by a render, with a 300 ms window that collapses bursts into one.
The active configuration keeps the Fleet Status Dock disabled, so Aurora owns
the compact, transient subagent view. If a deployment enables that dock later,
Aurora renders no duplicate subagents and sends no request at all.

## UI state event contract

Import the channel and message types from `state.ts`. On every session start,
Aurora emits `aurora-ui/state/request` with a new `sessionEpoch`. Providers
answer on `aurora-ui/state/snapshot`, then publish later changes on
`aurora-ui/state/patch`. Aurora discards snapshots and patches from older
epochs. `publishAuroraUiPatch` and `publishAuroraUiSnapshot` are the typed
publisher helpers.

Cleanup on session replacement, reload and shutdown restores the core footer and
working indicator, removes the widget, unsubscribes from the event bus, cancels
any pending subagent request and stops the shared ticker.
