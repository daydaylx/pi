# `@daydaylx/pi-frontend-protocol`

Versioned JSONL wire contract between Pi and external frontends. The package
contains transport-neutral TypeScript types, TypeBox runtime validators,
capability identifiers, request/event names and compatibility fixtures.

Wire protocol v1 requires an explicit `hello` exchange before requests or events.
Consumers must reject incompatible protocol majors and must not import Pi internals.

## Changelog

### 1.4.0

- Deprecates the `workflow` state field and the `workflow.list`/`workflow.set`
  methods: the planning workflow is gone and `work` is the only mode. Servers
  always report `workflow: { mode: "work", available: ["work"] }`;
  `workflow.list` returns `["work"]`; `workflow.set` with `"work"` is a no-op
  and refuses `simple_plan`/`detailed_plan` with `UNSUPPORTED_CAPABILITY`.
- The schemas still accept the retired mode names so that older recorded
  data stays valid; no server emits them any more.
- The slash commands `/workflow-set`, `/plan-decide`, `/plan-approve`,
  `/view-plan`, `/edit-plan` and `/save-plan` no longer exist, and the Pi-side
  command ids `workflow.open`, `plan.decide` and `plan.approve` are removed
  from the command registry. Clients must stop offering them.
- Wire major stays 1. The deprecated field and methods are removed with the
  next wire major.

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

### System-host goal evidence and recovery

The authoritative socket is `$XDG_RUNTIME_DIR/pi-system-host/frontend.sock`.
Use `clientSubmissionId`, `afterRevision`, and `requireVerification`.
The system host advertises `goal-readback` after the verification correction.
A mutating run cannot succeed just because the turn or tool completed.
Frontend `run.verify` assertions and frontend effect assertions in
`run.reconcile` (`applied` / `not_applied`) return `PERMISSION_DENIED`.
An evidence label, a generic `verification.changed` status, or an unrelated
successful check is not proof of a system goal. Any failed action remains failure.

Currently automatic goal evidence is deliberately limited to regular file
contents (16 MiB maximum, no final symlinks). In the system profile the agent can
use `system_file_verify(filePath, expectedSha256)` after `write` / `edit`.
Derive the expected digest from the requested target contents. The runtime
forwards the predicate only from this tool's completion; the host independently
reads the file again and associates the result with matching completed file
actions. A check of another file cannot cover a shell command or an unknown
system effect. Subsequent mutations invalidate older checks. Uncovered effects
stay `VERIFYING`; interrupted effects stay `UNCERTAIN` until trusted inspection.
No socket method executes arbitrary checks or grants replay permission.
This trusts the local Pi runtime and its system-profile tools, not frontend
claims. It does not isolate a malicious process already running as the same UID.

`run.events` returns the authoritative snapshot even after truncation, plus
`earliestAvailableRevision` and `historyTruncated`. Clients must reload the
snapshot on reconnect and use their last revision for event replay. Older v1
responses without these fields require detecting a gap from the first retained
revision. Never reconstruct missing events or retry with a new submission ID.
Unknown submission IDs are not replayed while corrupt manifests exist.
