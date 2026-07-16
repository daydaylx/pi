# Runtime Matrix

| Component | Pinned version / value | Verification |
| --- | --- | --- |
| Pi runtime | `0.80.7` | installed global package and `pi --version` |
| Pi dev dependency | `0.80.6` | exact local manifest/lock; `/setup-doctor` reports the drift |
| Node.js | `22.22.2` | `node --version` |
| npm | `10.9.7` | `npm --version` |
| Aurora UI | local TypeScript | typecheck, lifecycle and responsive render tests |
| Aurora theme | local `aurora-night` | Truecolor and 256-color theme loading |
| Plan workflow | local TypeScript | lifecycle, sidecar and `plan_progress` tests |
| LSP | local TypeScript | fake-server transport, document and tool suites |
| pi-subagents | `daydaylx/pi-subagents@dd716cfc8c3a9b0ee35632752ac2b1736cd7de61` | exact runtime package pin |
| Operating system | Linux | CI and local verification |
| Terminals | narrow, normal and wide layouts | responsive UI harness |

## Release gate

`npm run verify` must pass with zero known failures. The currently installed Pi
runtime and the locked development dependency still differ by one patch
version; aligning them requires an explicitly approved dependency update and
lockfile refresh. Until then `/setup-doctor` keeps the mismatch visible.

LSP binaries are host prerequisites, not managed dependencies. Missing
binaries must produce a structured soft failure and must never trigger an
automatic installation.

## Rollback

Aurora is activated only through `settings.json`: the local Aurora extension,
theme and removal of the former UI package sources. Restore the previous
package/extension allowlists to return to the former cockpit. Plan Markdown,
sidecars, authentication and sessions are not migrated by the UI switch.
