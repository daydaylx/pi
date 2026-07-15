# Runtime Matrix

| Component        | Pinned version / value                                              | Verification                                                |
| ---------------- | ------------------------------------------------------------------- | ----------------------------------------------------------- |
| Pi Coding Agent  | `0.80.6`                                                            | `pi --version`                                              |
| Node.js          | `22.22.2`                                                           | `node --version`                                            |
| npm              | `10.9.7`                                                            | `npm --version`                                             |
| pi-zentui        | `daydaylx/pi-zentui@06d23d5f2b12f9c49ee26a1c4d8ec776b2ef8adc`       | editor, compact agent footer, user chrome                   |
| pi-tool-display  | `daydaylx/pi-tool-display@dd33d1340f5ac598b1873034016f1a05eed0619c` | compact built-in and subagent tool timeline                 |
| pi-subagents     | `daydaylx/pi-subagents@dd716cfc8c3a9b0ee35632752ac2b1736cd7de61`    | orchestration and lifecycle tracking; async widget disabled |
| Catppuccin       | `@ujjwalgrover/pi-catppuccin@1.0.0`                                 | `catppuccin-mocha` theme                                    |
| Operating system | Linux                                                               | CI and local clean install                                  |
| Terminals        | Kitty narrow split, wide terminal                                   | manual smoke test                                           |

## Rollback combination

Use the matching exact package commits above with Pi `0.80.6`. Restore the
`backup/pre-minimal-rebuild` tag only into a separate branch; retained local
worktree changes are available through the named pre-rebuild stash.
