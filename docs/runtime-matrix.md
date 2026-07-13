# Runtime Matrix

| Component | Pinned version / value | Verification |
| --- | --- | --- |
| Pi Coding Agent | `0.80.6` | `pi --version` |
| Node.js | `22.22.2` | `node --version` |
| npm | `10.9.7` | `npm --version` |
| pi-zentui | `0.3.0` | editor, footer, user chrome |
| pi-tool-display | `0.5.0` | seven built-in tool owners |
| pi-subagents | `0.34.0` | orchestration, temporary activity widget, status events |
| Catppuccin | `@ujjwalgrover/pi-catppuccin@1.0.0` | `catppuccin-mocha` theme |
| Operating system | Linux | CI and local clean install |
| Terminals | Kitty narrow split, wide terminal | manual smoke test |

## Rollback combination

Use the matching exact package versions above with Pi `0.80.6`. Restore the
`backup/pre-minimal-rebuild` tag only into a separate branch; retained local
worktree changes are available through the named pre-rebuild stash.
