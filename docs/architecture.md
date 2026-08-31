# Pi Architecture

Pi is the core CLI/TUI agent runtime setup. The externally pinned
`@earendil-works/pi-coding-agent` supplies the runtime; this repository owns its
configuration, extensions, permission/workflow policy, verification, resilience,
LSP, subagent harness and Aurora terminal frontend.

```text
Core runtime and extensions
          |
          +--> neutral frontend state bus --> Aurora TUI
          |
          +--> frontend bridge/server --> JSONL Frontend API v1
                                           |
                                           +--> external Pi GUI
```

`extensions/aurora-ui/` is terminal UI and remains in Pi. Desktop Electron code
belongs only to `daydaylx/pi-gui`.

The public frontend package lives below `npm/packages/frontend-protocol/` so it
resolves dependencies through the established nested `npm/` installation
boundary. It is independently packable as
`@daydaylx/pi-frontend-protocol`. `frontend-server/` adapts the upstream runtime
RPC to that stable contract and uses public `SessionManager` APIs for session
discovery and history.

Core state is authoritative. Frontends may keep transient visual state but do
not implement permission, workflow, model routing, verification, subagent or
session storage logic.
