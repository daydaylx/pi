export const PROTOCOL_VERSION = 1 as const;
export const PROTOCOL_PACKAGE_VERSION = "1.0.0" as const;

export const CAPABILITIES = [
  "sessions",
  "messages",
  "streaming",
  "tool-calls",
  "workflow",
  "tasks",
  "subagents",
  "permissions",
  "verification",
  "changes",
  "lsp",
  "models",
  "thinking",
  "notifications",
  "configuration",
  "extension-ui",
] as const;
export type Capability = (typeof CAPABILITIES)[number];
export const isKnownCapability = (value: string): value is Capability =>
  (CAPABILITIES as readonly string[]).includes(value);

export const REQUEST_METHODS = [
  "system.ping",
  "session.list",
  "session.create",
  "session.open",
  "session.current",
  "session.messages",
  "session.stats",
  "agent.prompt",
  "agent.steer",
  "agent.followUp",
  "agent.abort",
  "model.list",
  "model.set",
  "model.cycle",
  "thinking.list",
  "thinking.set",
  "thinking.cycle",
  "workflow.list",
  "workflow.set",
  "permission.list",
  "permission.set",
  "command.list",
  "command.invoke",
  "verification.run",
  "changes.list",
  "configuration.get",
  "ui.respond",
] as const;
export type RequestMethod = (typeof REQUEST_METHODS)[number];
export const isKnownRequestMethod = (value: string): value is RequestMethod =>
  (REQUEST_METHODS as readonly string[]).includes(value);

export const EVENT_NAMES = [
  "state.snapshot",
  "state.patch",
  "message.started",
  "message.delta",
  "message.completed",
  "thinking.started",
  "thinking.delta",
  "thinking.completed",
  "tool.started",
  "tool.updated",
  "tool.completed",
  "tool.failed",
  "session.changed",
  "subagent.changed",
  "verification.changed",
  "permission.requested",
  "extension-ui.requested",
  "notification",
  "core.disconnected",
  "core.reconnected",
  "error",
] as const;
export type EventName = (typeof EVENT_NAMES)[number];
export const isKnownEventName = (value: string): value is EventName =>
  (EVENT_NAMES as readonly string[]).includes(value);

export const ERROR_CODES = [
  "PI_NOT_FOUND",
  "PI_START_FAILED",
  "PI_CRASHED",
  "RPC_DISCONNECTED",
  "PROTOCOL_MISMATCH",
  "UNSUPPORTED_CAPABILITY",
  "UNKNOWN_METHOD",
  "INVALID_REQUEST",
  "REQUEST_TIMEOUT",
  "SESSION_NOT_FOUND",
  "SESSION_INVALID",
  "TOOL_FAILED",
  "PERMISSION_DENIED",
  "PROVIDER_ERROR",
  "INTERNAL_ERROR",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];
