# Pi Frontend API v1

Pi remains the sole owner of agent runtime, sessions, workflows, permissions,
verification, subagents, models and tools. External frontends communicate with
`bin/pi-frontend`; they never import Pi extensions or read session files.

## Transport and handshake

The transport is UTF-8 JSON Lines over stdin/stdout. The first client frame is:

```json
{
  "kind": "hello",
  "client": { "name": "example-frontend", "version": "0.1.0" },
  "supportedProtocolVersions": [1]
}
```

Pi responds with an accepted frame containing `protocolVersion`, Pi/server
versions, the optional per-process `hostEpoch`, and the capabilities available on this connection. If no version
overlaps, Pi responds with `PROTOCOL_MISMATCH`; no requests are processed before
a successful handshake.

Subsequent requests, responses and events carry `protocolVersion: 1`. Requests
have a client-generated `id`; events have a monotonically increasing `sequence`
per connection. Runtime schemas and fixtures are exported by
`@daydaylx/pi-frontend-protocol`.

## Capabilities

V1 defines `sessions`, `session-management`, `messages`, `streaming`, `tool-calls`, `workflow`,
`tasks`, `subagents`, `permissions`, `verification`, `changes`, `lsp`, `models`,
`thinking`, `notifications`, `configuration`, `extension-ui`, `host-epoch`,
`approval-envelope`, `paged-messages` and `runs` (on `PiSystemHost`). A frontend must
disable or hide a feature when its capability is absent; clients without the
`session-management` capability show session management actions as disabled
("nicht verfügbar").

State entries of `subagents` carry `runId`, `agent` (agent id), `label`,
`status` and the optional `objective` and `profile`. The former `role` field
was removed: subagents no longer have a permanent role identity (ADR 031).
Frontends must render `label` (and `objective`/`profile` when present) instead
of a role name.

Capabilities describe readable state/events as well as commands. A capability
may therefore be present even when a particular optional command returns
`UNSUPPORTED_CAPABILITY` on an older Pi runtime.

## Requests

| Area           | Methods                                                                                                  |
| -------------- | -------------------------------------------------------------------------------------------------------- |
| System         | `system.ping`                                                                                            |
| Sessions       | `session.list`, `session.create`, `session.open`, `session.rename`, `session.archive`, `session.delete`, `session.current`, `session.messages`, `session.stats` |
| Agent          | `agent.prompt`, `agent.steer`, `agent.followUp`, `agent.abort`                                           |
| Models         | `model.list`, `model.set`, `model.cycle`                                                                 |
| Thinking       | `thinking.list`, `thinking.set`, `thinking.cycle`                                                        |
| Workflow       | `workflow.list`, `workflow.set` (deprecated since 1.4.0: only `work` exists)                             |
| Permissions    | `permission.list`, `permission.set`                                                                      |
| Commands       | `command.list`, `command.invoke`                                                                         |
| State/services | `verification.run`, `changes.list`, `configuration.get`, `ui.respond`                                    |
| Runs (Host)    | `run.submit`, `run.current`, `run.get`, `run.list`, `run.cancel`, `run.events`, `run.reconcile`, `run.resume` |

`run.verify` remains a recognized protocol shape for compatibility, but the
PiSystem Host rejects client submissions with `PERMISSION_DENIED`; only a
host-side readback tied to the target may record positive verification.

Session IDs are opaque. `session.list` never returns a session filename, and
`session.open` accepts only an ID previously issued by the server.

`session.messages` accepts optional `id`, `limit` (1–500, default 100) and
`before` (opaque cursor, at most 128 characters). It returns the newest page
before the cursor, oldest first, with `nextCursor` when older messages remain.
Each page is limited to 100,000 serialized characters; a single oversized
message has its text blocks shortened with `…[gekürzt]`. Calls without
parameters therefore return the newest page, not the full history.

Session management methods (`session.rename`, `session.archive`, `session.delete`)
operate on inactive sessions and require a dedicated session directory
(`PI_CODING_AGENT_SESSION_DIR`):

- `session.rename`: Parameters `{ id, title }`. The title is trimmed and must be
  1–120 characters without control characters (U+0000–U+001F, U+007F). An empty
  title after trimming (`title: ""`) removes the title override. Returns `{}`.
- `session.archive`: Parameters `{ id, archived: boolean }`. Sets or clears the
  archive flag. Returns `{}`.
- `session.delete`: Parameters `{ id, confirm: true }`. Requires literal
  `confirm: true`. The session file is moved to
  `<sessionDir>/.trash/<basename>.<Date.now()>` with mode 0700 and its index
  entry is removed. Returns `{}`.

Rules and error conditions for session management:
- All three methods validate `id`: 1–128 characters matching `^[A-Za-z0-9_-]+$`.
  Path characters, dots, slashes, or whitespace yield `INVALID_REQUEST`.
- If `PI_CODING_AGENT_SESSION_DIR` is not set, all three methods fail with
  `INVALID_REQUEST` ("Session management requires a dedicated session directory").
- If an agent turn is active (`activity.kind !== "idle"`), mutations fail with
  `SESSION_BUSY`.
- The active session (`get_state` -> `normalizeCurrentSession(...).id`) cannot be
  renamed, archived, or deleted (fails with `SESSION_BUSY`).
- The session list is freshly reloaded (`listAll`) before each mutation. Unknown
  IDs fail with `INVALID_REQUEST` ("Session not found"). A second delete of the
  same ID fails with `INVALID_REQUEST`.
- Only persisted sessions are managed: Pi writes a session file with the first
  message, so a session created by `session.create` that has no message yet is
  neither listed nor addressable (`INVALID_REQUEST`, "Session not found").
- For `session.delete`, the target file must be a regular file (not a symlink)
  residing directly within `PI_CODING_AGENT_SESSION_DIR`.
- Overrides and flags are stored in `.frontend-index.json` in the session
  directory (mode 0600, atomic writes). A corrupt or missing index file defaults
  to an empty index without crashing.
- `session.list` reflects the title override as `name` and includes optional
  `archived: true` for archived sessions. Archived sessions remain in the list.

## Events

V1 events are `state.snapshot`, `state.patch`, the message/thinking lifecycle,
the tool lifecycle, `agent.settled`, `session.changed`, `subagent.changed`,
`verification.changed`, `permission.requested`, `extension-ui.requested`,
`notification`, `core.disconnected`, `core.reconnected`,
`extension-ui.resolved` and `error`.

`agent.settled` signals that Pi has finished processing the prompt turn and will
not continue automatically through retries, compaction recovery, or follow-up
work. The payload contains `{ aborted: boolean }`, allowing frontends to
distinguish an aborted run (`aborted: true`) from normal completion
(`aborted: false`). Note that `agent.abort` only aborts the current agent turn
and does not abort background system jobs or external processes.

The `permission.requested` event is reserved and deprecated; it is never
emitted by the server. Interactive approvals flow through
`extension-ui.requested` and are answered via `ui.respond`.

`extension-ui.requested` includes an `approval` envelope with a SHA-256 digest
of the displayed method/title/message/options, the current `sessionId` when
available, and ISO-8601 creation and expiry times. Requests expire after two
minutes by default. `extension-ui.resolved` reports `answered`, `expired` or
`cancelled`. The upstream RPC supplies only title/message/options, so the
digest binds the displayed action and does not bind a tool or tool call.

The protocol package exports method-specific parameter/result validators and
event-specific payload validators. Implementations validate at both ends; the
generic wire envelope alone is not sufficient for dispatch.

Unknown events on the same protocol major are non-fatal diagnostics for a
frontend. Unknown request methods receive `UNKNOWN_METHOD`; neither case may fail
silently.

## Errors

Errors contain a stable `code`, user-facing `message`, `retryable` flag and
`correlationId`. V1 codes cover missing/start-failed/crashed Pi, disconnected
RPC, incompatible protocol, unsupported capabilities, invalid/unknown requests,
timeouts, sessions, tools, permissions, providers, oversized backend results
(`RESULT_TOO_LARGE`) and internal failures. The host rejects backend frames
larger than 8 MiB while remaining available; client frames remain limited to
256 KiB.

Logs record correlation, method, duration and error code only by default. Prompt
content, tool inputs/results, credentials and raw stderr are not frontend log
payloads.

## Compatibility

- Wire major 1 is required for this contract generation.
- The bundled server accepts an explicit allowlist of Pi runtime lines: 0.84.x,
  1.0.x, 1.2.x and 1.3.x. Another runtime is rejected during the handshake with
  `PI_START_FAILED`, a message naming the detected version and the supported
  lines, and `retryable: false`, instead of being reported under a supported
  version. Adding a line requires a verified RPC contract and tests.
- Streaming events are derived from the runtime's delta-only `message_update`
  records (`assistantMessageEvent`): `text_delta` becomes `message.delta` with
  `delta`; `thinking_start`/`thinking_delta`/`thinking_end` become
  `thinking.started`/`thinking.delta`/`thinking.completed`. Tool lifecycle
  comes from `tool_execution_*`, the authoritative text from `message.completed`.
  Other update shapes produce no event. Fire-and-forget extension UI methods
  (`setStatus`, `setWidget`, `setTitle`, `set_editor_text`) are not forwarded.
- Protocol package version 1.4.0 deprecates `workflow.list`/`workflow.set` and the `workflow` state field (planning workflow removed; `work` is the only mode); wire major stays 1.
- Protocol package version 1.3.0 adds session-management (session.rename/archive/delete), permission.list entries and agent.settled; wire major stays 1.
- Nach dem Freeze nur noch versionierte, additive Änderungen durch den Contract-Owner.
- Protocol package version 1.2.0 adds optional capabilities, paged message
  parameters, approval metadata/events and `RESULT_TOO_LARGE`.
- Minor package releases may add optional capabilities, methods or events.
- Existing schemas and meanings cannot change incompatibly within wire major 1.
- Consumers validate every inbound envelope and must show a concrete mismatch
  error rather than attempting a silent fallback.
