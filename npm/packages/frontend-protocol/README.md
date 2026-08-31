# `@daydaylx/pi-frontend-protocol`

Versioned JSONL wire contract between Pi and external frontends. The package
contains transport-neutral TypeScript types, TypeBox runtime validators,
capability identifiers, request/event names and compatibility fixtures.

Wire protocol v1 requires an explicit `hello` exchange before requests or events.
Consumers must reject incompatible protocol majors and must not import Pi internals.
