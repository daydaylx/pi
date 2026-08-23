import type { EventBus, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { WORKFLOW_MODES, type WorkflowMode } from "../shared/workflow-mode.ts";

export const AURORA_UI_CHANNELS = {
  request: "aurora-ui/state/request",
  patch: "aurora-ui/state/patch",
  snapshot: "aurora-ui/state/snapshot",
} as const;

/** Presentation mirror of the selected workflow mode. */
export type AuroraWorkflowPhase = WorkflowMode;

export type AuroraActivityKind = "idle" | "thinking" | "tool" | "responding";

export interface AuroraTaskChanges {
  filesCount: number;
  files: string[];
  linesAdded: number;
  linesRemoved: number;
}

export interface AuroraVerificationSummary {
  status?: string;
  declaredRequiredIds: string[];
  requiredOutcomes: Record<string, string>;
  blockingRecommendedIds: string[];
}

export interface AuroraUiState {
  sessionEpoch: string;
  workflow: {
    phase: AuroraWorkflowPhase;
    label: string;
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
  };
  changes: AuroraTaskChanges | null;
  verification: AuroraVerificationSummary | null;
}

export interface AuroraUiStatePatch {
  workflow?: Partial<AuroraUiState["workflow"]>;
  permissions?: Partial<AuroraUiState["permissions"]>;
  lsp?: Partial<AuroraUiState["lsp"]>;
  model?: Partial<AuroraUiState["model"]>;
  activity?: Partial<AuroraUiState["activity"]>;
  changes?: AuroraTaskChanges | null;
  verification?: AuroraVerificationSummary | null;
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

export function isAuroraUiPatchEvent(
  value: unknown,
): value is AuroraUiPatchEvent {
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

/** Returns whether the presentation state actually changed. */
export function mergeAuroraUiState(
  state: AuroraUiState,
  patch: AuroraUiStatePatch,
): boolean {
  let changed = false;
  const workflowPhases: readonly AuroraWorkflowPhase[] = WORKFLOW_MODES;
  const activityKinds: readonly AuroraActivityKind[] = [
    "idle",
    "thinking",
    "tool",
    "responding",
  ];

  if (patch.workflow) {
    if (
      patch.workflow.phase &&
      workflowPhases.includes(patch.workflow.phase) &&
      state.workflow.phase !== patch.workflow.phase
    ) {
      state.workflow.phase = patch.workflow.phase;
      changed = true;
    }
    if (
      typeof patch.workflow.label === "string" &&
      state.workflow.label !== patch.workflow.label
    ) {
      state.workflow.label = patch.workflow.label;
      changed = true;
    }
  }
  if (patch.permissions) {
    if ("level" in patch.permissions) {
      const level =
        typeof patch.permissions.level === "string"
          ? patch.permissions.level
          : undefined;
      if (state.permissions.level !== level) {
        state.permissions.level = level;
        changed = true;
      }
    }
    if ("label" in patch.permissions) {
      const label =
        typeof patch.permissions.label === "string"
          ? patch.permissions.label
          : undefined;
      if (state.permissions.label !== label) {
        state.permissions.label = label;
        changed = true;
      }
    }
  }
  if (patch.lsp) {
    if ("state" in patch.lsp) {
      const lspState =
        typeof patch.lsp.state === "string" ? patch.lsp.state : undefined;
      if (state.lsp.state !== lspState) {
        state.lsp.state = lspState;
        changed = true;
      }
    }
    if ("detail" in patch.lsp) {
      const detail =
        typeof patch.lsp.detail === "string" ? patch.lsp.detail : undefined;
      if (state.lsp.detail !== detail) {
        state.lsp.detail = detail;
        changed = true;
      }
    }
  }
  if (patch.model) {
    if ("id" in patch.model) {
      const id =
        typeof patch.model.id === "string" ? patch.model.id : undefined;
      if (state.model.id !== id) {
        state.model.id = id;
        changed = true;
      }
    }
    if ("thinking" in patch.model) {
      const thinking =
        typeof patch.model.thinking === "string"
          ? patch.model.thinking
          : undefined;
      if (state.model.thinking !== thinking) {
        state.model.thinking = thinking;
        changed = true;
      }
    }
  }
  if (patch.activity) {
    if (
      patch.activity.kind &&
      activityKinds.includes(patch.activity.kind) &&
      state.activity.kind !== patch.activity.kind
    ) {
      state.activity.kind = patch.activity.kind;
      changed = true;
    }
  }
  if ("changes" in patch) {
    const next = patch.changes ?? null;
    if (JSON.stringify(state.changes) !== JSON.stringify(next)) {
      state.changes = next;
      changed = true;
    }
  }
  if ("verification" in patch) {
    const next = patch.verification ?? null;
    if (JSON.stringify(state.verification) !== JSON.stringify(next)) {
      state.verification = next;
      changed = true;
    }
  }
  return changed;
}
