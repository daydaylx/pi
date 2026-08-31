# Pi Frontend API v1

Pi remains the sole owner of agent runtime, sessions, workflows, permissions,
verification, subagents, models and tools. External frontends communicate with
`bin/pi-frontend`; they never import Pi extensions or read session files.

## Transport and handshake

The transport is UTF-8 JSON Lines over stdin/stdout. The first client frame is:

```json
{
  "kind": "hello",
  "client": { "name": "pi-gui", "version": "0.1.0" },
  "supportedProtocolVersions": [1]
}
```

Pi responds with an accepted frame containing `protocolVersion`, Pi/server
versions and the capabilities available on this connection. If no version
overlaps, Pi responds with `PROTOCOL_MISMATCH`; no requests are processed before
a successful handshake.

Subsequent requests, responses and events carry `protocolVersion: 1`. Requests
have a client-generated `id`; events have a monotonically increasing `sequence`
per connection. Runtime schemas and fixtures are exported by
`@daydaylx/pi-frontend-protocol`.

## Capabilities

V1 defines `sessions`, `messages`, `streaming`, `tool-calls`, `workflow`,
`tasks`, `subagents`, `permissions`, `verification`, `changes`, `lsp`, `models`,
`thinking`, `notifications`, `configuration` and `extension-ui`. A frontend must
disable or hide a feature when its capability is absent.

Capabilities describe readable state/events as well as commands. A capability
may therefore be present even when a particular optional command returns
`UNSUPPORTED_CAPABILITY` on an older Pi runtime.

## Requests

| Area           | Methods                                                                                                  |
| -------------- | -------------------------------------------------------------------------------------------------------- |
| System         | `system.ping`                                                                                            |
| Sessions       | `session.list`, `session.create`, `session.open`, `session.current`, `session.messages`, `session.stats` |
| Agent          | `agent.prompt`, `agent.steer`, `agent.followUp`, `agent.abort`                                           |
| Models         | `model.list`, `model.set`, `model.cycle`                                                                 |
| Thinking       | `thinking.list`, `thinking.set`, `thinking.cycle`                                                        |
| Workflow       | `workflow.list`, `workflow.set`                                                                          |
| Permissions    | `permission.list`, `permission.set`                                                                      |
| Commands       | `command.list`, `command.invoke`                                                                         |
| State/services | `verification.run`, `changes.list`, `configuration.get`, `ui.respond`                                    |

Session IDs are opaque. `session.list` never returns a session filename, and
`session.open` accepts only an ID previously issued by the server.

## Events

V1 events are `state.snapshot`, `state.patch`, the message/thinking lifecycle,
the tool lifecycle, `session.changed`, `subagent.changed`,
`verification.changed`, `permission.requested`, `extension-ui.requested`, `notification`,
`core.disconnected`, `core.reconnected` and `error`.

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
timeouts, sessions, tools, permissions, providers and internal failures.

Logs record correlation, method, duration and error code only by default. Prompt
content, tool inputs/results, credentials and raw stderr are not frontend log
payloads.

## Compatibility

- Wire major 1 is required for this contract generation.
- The bundled server accepts the pinned Pi 0.84.x runtime line. Another runtime
  is rejected during the handshake instead of being reported under the pinned
  version.
- Minor package releases may add optional capabilities, methods or events.
- Existing schemas and meanings cannot change incompatibly within wire major 1.
- Consumers validate every inbound envelope and must show a concrete mismatch
  error rather than attempting a silent fallback.
