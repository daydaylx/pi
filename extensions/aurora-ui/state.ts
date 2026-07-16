import type {
  EventBus,
  ExtensionAPI,
} from "@earendil-works/pi-coding-agent";

export const AURORA_UI_CHANNELS = {
  request: "aurora-ui/state/request",
  patch: "aurora-ui/state/patch",
  snapshot: "aurora-ui/state/snapshot",
} as const;

export type AuroraWorkflowPhase =
  | "idle"
  | "drafting"
  | "reviewed"
  | "executing"
  | "ready"
  | "archived";

export type AuroraActivityKind =
  | "idle"
  | "thinking"
  | "tool"
  | "responding";

export interface AuroraUiState {
  sessionEpoch: string;
  workflow: {
    phase: AuroraWorkflowPhase;
    label: string;
    step?: string;
    completed?: number;
    total?: number;
  };
  permissions: {
    level?: string;
    label?: string;
  };
  lsp: {
    state?: string;
    detail?: string;
  };
  model: {
    id?: string;
    thinking?: string;
  };
  activity: {
    kind: AuroraActivityKind;
    label?: string;
    activeTools: number;
  };
}

export interface AuroraUiStatePatch {
  workflow?: Partial<AuroraUiState["workflow"]>;
  permissions?: Partial<AuroraUiState["permissions"]>;
  lsp?: Partial<AuroraUiState["lsp"]>;
  model?: Partial<AuroraUiState["model"]>;
  activity?: Partial<AuroraUiState["activity"]>;
}

export interface AuroraUiStateRequest {
  type: "request";
  requestId: string;
  sessionEpoch: string;
  requester: string;
}

export interface AuroraUiPatchEvent {
  type: "patch";
  sessionEpoch: string;
  source: string;
  patch: AuroraUiStatePatch;
}

export interface AuroraUiSnapshotEvent {
  type: "snapshot";
  requestId: string;
  sessionEpoch: string;
  source: string;
  state: AuroraUiStatePatch;
}

function emit(bus: EventBus, channel: string, value: unknown): void {
  bus.emit(channel, value);
}

/** Publish a state patch only for the epoch obtained from a state request. */
export function publishAuroraUiPatch(
  pi: Pick<ExtensionAPI, "events">,
  sessionEpoch: string,
  source: string,
  patch: AuroraUiStatePatch,
): void {
  emit(pi.events, AURORA_UI_CHANNELS.patch, {
    type: "patch",
    sessionEpoch,
    source,
    patch,
  } satisfies AuroraUiPatchEvent);
}

/** Answer a request with the provider's complete view of its owned fields. */
export function publishAuroraUiSnapshot(
  pi: Pick<ExtensionAPI, "events">,
  request: AuroraUiStateRequest,
  source: string,
  state: AuroraUiStatePatch,
): void {
  emit(pi.events, AURORA_UI_CHANNELS.snapshot, {
    type: "snapshot",
    requestId: request.requestId,
    sessionEpoch: request.sessionEpoch,
    source,
    state,
  } satisfies AuroraUiSnapshotEvent);
}

export function isAuroraUiStateRequest(
  value: unknown,
): value is AuroraUiStateRequest {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<AuroraUiStateRequest>;
  return (
    event.type === "request" &&
    typeof event.requestId === "string" &&
    typeof event.sessionEpoch === "string" &&
    typeof event.requester === "string"
  );
}

export function isAuroraUiPatchEvent(value: unknown): value is AuroraUiPatchEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<AuroraUiPatchEvent>;
  return (
    event.type === "patch" &&
    typeof event.sessionEpoch === "string" &&
    typeof event.source === "string" &&
    Boolean(event.patch) &&
    typeof event.patch === "object"
  );
}

export function isAuroraUiSnapshotEvent(
  value: unknown,
): value is AuroraUiSnapshotEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<AuroraUiSnapshotEvent>;
  return (
    event.type === "snapshot" &&
    typeof event.requestId === "string" &&
    typeof event.sessionEpoch === "string" &&
    typeof event.source === "string" &&
    Boolean(event.state) &&
    typeof event.state === "object"
  );
}

export function mergeAuroraUiState(
  state: AuroraUiState,
  patch: AuroraUiStatePatch,
): void {
  const workflowPhases: readonly AuroraWorkflowPhase[] = [
    "idle",
    "drafting",
    "reviewed",
    "executing",
    "ready",
    "archived",
  ];
  const activityKinds: readonly AuroraActivityKind[] = [
    "idle",
    "thinking",
    "tool",
    "responding",
  ];

  if (patch.workflow) {
    if (
      patch.workflow.phase &&
      workflowPhases.includes(patch.workflow.phase)
    )
      state.workflow.phase = patch.workflow.phase;
    if (typeof patch.workflow.label === "string")
      state.workflow.label = patch.workflow.label;
    if ("step" in patch.workflow) {
      state.workflow.step =
        typeof patch.workflow.step === "string" ? patch.workflow.step : undefined;
    }
    if (typeof patch.workflow.completed === "number")
      state.workflow.completed = Math.max(0, Math.floor(patch.workflow.completed));
    if (typeof patch.workflow.total === "number")
      state.workflow.total = Math.max(0, Math.floor(patch.workflow.total));
  }
  if (patch.permissions) {
    if ("level" in patch.permissions)
      state.permissions.level =
        typeof patch.permissions.level === "string"
          ? patch.permissions.level
          : undefined;
    if ("label" in patch.permissions)
      state.permissions.label =
        typeof patch.permissions.label === "string"
          ? patch.permissions.label
          : undefined;
  }
  if (patch.lsp) {
    if ("state" in patch.lsp)
      state.lsp.state =
        typeof patch.lsp.state === "string" ? patch.lsp.state : undefined;
    if ("detail" in patch.lsp)
      state.lsp.detail =
        typeof patch.lsp.detail === "string" ? patch.lsp.detail : undefined;
  }
  if (patch.model) {
    if ("id" in patch.model)
      state.model.id = typeof patch.model.id === "string" ? patch.model.id : undefined;
    if ("thinking" in patch.model)
      state.model.thinking =
        typeof patch.model.thinking === "string" ? patch.model.thinking : undefined;
  }
  if (patch.activity) {
    if (
      patch.activity.kind &&
      activityKinds.includes(patch.activity.kind)
    )
      state.activity.kind = patch.activity.kind;
    if ("label" in patch.activity)
      state.activity.label =
        typeof patch.activity.label === "string" ? patch.activity.label : undefined;
    if (typeof patch.activity.activeTools === "number")
      state.activity.activeTools = Math.max(
        0,
        Math.floor(patch.activity.activeTools),
      );
  }
}
