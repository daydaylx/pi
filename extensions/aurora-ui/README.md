# Aurora UI

Aurora UI is the sole owner of Pi's custom editor, footer, transient activity
widget and working indicator while the extension is active. It uses only the
public extension UI and lifecycle hooks. Core tools are not replaced or wrapped.

The theme is `themes/aurora-night.json`. Motion is read from the effective
central setup configuration (`ui.motion`):

- `contextual`: one shared 100 ms ticker runs only while work is visible.
- `reduced`: static activity indicator; no extension ticker.
- `off`: no animated/working indicator; activity text remains available.

## UI state event contract

Import the channel and message types from `state.ts`. On every session start,
Aurora emits `aurora-ui/state/request` with a new `sessionEpoch`. Providers
answer on `aurora-ui/state/snapshot`, then publish later changes on
`aurora-ui/state/patch`. Aurora discards snapshots and patches from older
epochs. `publishAuroraUiPatch` and `publishAuroraUiSnapshot` are the typed
publisher helpers.

Cleanup on session replacement, reload and shutdown restores the core editor,
footer and working indicator, removes the widget, unsubscribes from the event
bus and stops the shared ticker.
