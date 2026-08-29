/**
 * Frontend-Protokoll (Version 1.0.0): die stabile Grenze zwischen Pi-Core
 * und Frontends. Aurora und die Desktop-GUI sind gleichberechtigte
 * Konsumenten; keines von beiden ist Datenquelle oder Wahrheit.
 */
export {
  PROTOCOL_VERSION,
  FRONTEND_STATE_CHANNELS,
  FRONTEND_STATE_FIELDS,
  STATE_FIELD_OWNERS,
} from "./state-contract.ts";
export type {
  FrontendActivityKind,
  FrontendStateFieldName,
  FrontendTaskChanges,
  FrontendUiPatchEvent,
  FrontendUiSnapshotEvent,
  FrontendUiState,
  FrontendUiStatePatch,
  FrontendUiStateRequest,
  FrontendVerificationSummary,
  FrontendWorkflowPhase,
  StateFieldOwner,
  StateTransport,
} from "./state-contract.ts";

export {
  isFrontendUiPatchEvent,
  isFrontendUiSnapshotEvent,
  isFrontendUiStateRequest,
  mergeFrontendUiState,
} from "./state-helpers.ts";

export { COMMAND_REGISTRY, REQUIRED_COMMAND_IDS } from "./commands.ts";
export type {
  CommandId,
  CommandTarget,
  CommandTargetKind,
  ProtocolCommandDef,
} from "./commands.ts";

export { EVENT_SOURCES, PROTOCOL_EVENTS } from "./events.ts";
export type { EventSource, ProtocolEventName } from "./events.ts";

export { SHORTCUT_COMMAND_MAP } from "./shortcut-mapping.ts";
export type { ShortcutMapping } from "./shortcut-mapping.ts";

export {
  auroraPatchToProtocolEvent,
  auroraSnapshotToProtocolEvent,
  protocolStateRequest,
} from "./compatibility.ts";
export type {
  ProtocolStatePatchEvent,
  ProtocolStateSnapshotEvent,
} from "./compatibility.ts";
