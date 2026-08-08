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
It shows the workflow, the model, the thinking level, the context share and the
verification state, in that order of importance, and drops whole segments from
the least important end as the terminal narrows. Risk segments — YOLO, a failed
verification, a broken language server — ignore the width tier and are the last
thing dropped. Size classes come from `shared/layout.ts`, shared with the menu
shell.

`renderFooterLines` is pure. Everything it prints was already in runtime state:
it starts no process, probes neither git nor the LSP, asks no provider and reads
no file. It is called on every frame, so anything else would be paid for
continuously.

**Activity widget** (`tool-renderers.ts`) — transient, above the editor, present
only while a turn is running. It carries the thinking line, the running tools
and the subagents of the current turn. Finished work leaves the widget rather
than turning into a success block.

Subagent status is the one thing Aurora cannot read directly. Foreground runs
come off the `subagent` tool call itself; async runs need a request to the
subagent package, and that request is triggered by `subagent:control-event`
alone, never by a render, with a 300 ms window that collapses bursts into one.
When `extensions/subagent/config.json` enables the Fleet Status Dock, Aurora
renders no subagents and sends no request at all.

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
