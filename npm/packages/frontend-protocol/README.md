# `@daydaylx/pi-frontend-protocol`

Versioned JSONL wire contract between Pi and external frontends. The package
contains transport-neutral TypeScript types, TypeBox runtime validators,
capability identifiers, request/event names and compatibility fixtures.

Wire protocol v1 requires an explicit `hello` exchange before requests or events.
Consumers must reject incompatible protocol majors and must not import Pi internals.

## Changelog

### 1.3.0

- Adds session-management (`session.rename`, `session.archive`, `session.delete`).
- Adds `permission.list` entries (`levels` and optional `entries` with settability).
- Adds `agent.settled` event payload (`{ aborted: boolean }`).
- Wire major stays 1.

### 1.2.0

- Adds optional capabilities (`host-epoch`, `approval-envelope`, `paged-messages`).
- Adds paged message parameters and cursor validation for `session.messages`.
- Adds approval metadata/envelope and events (`extension-ui.requested`, `extension-ui.resolved`).
- Adds `RESULT_TOO_LARGE` error code.
