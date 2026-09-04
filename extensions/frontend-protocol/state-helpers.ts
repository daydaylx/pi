import { WORKFLOW_MODES } from "../shared/workflow-mode.ts";
import type {
  FrontendActivityKind,
  FrontendPlanReadiness,
  FrontendUiPatchEvent,
  FrontendUiSnapshotEvent,
  FrontendUiState,
  FrontendUiStatePatch,
  FrontendUiStateRequest,
  FrontendWorkflowPhase,
} from "./state-contract.ts";

/** Runtime-Guards für den neutralen Frontend-Zustandsvertrag. */
export function isFrontendUiStateRequest(
  value: unknown,
): value is FrontendUiStateRequest {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<FrontendUiStateRequest>;
  return (
    event.type === "request" &&
    typeof event.requestId === "string" &&
    typeof event.sessionEpoch === "string" &&
    typeof event.requester === "string"
  );
}

export function isFrontendUiPatchEvent(value: unknown): value is FrontendUiPatchEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<FrontendUiPatchEvent>;
  return (
    event.type === "patch" &&
    typeof event.sessionEpoch === "string" &&
    typeof event.source === "string" &&
    Boolean(event.patch) &&
    typeof event.patch === "object"
  );
}

export function isFrontendUiSnapshotEvent(
  value: unknown,
): value is FrontendUiSnapshotEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<FrontendUiSnapshotEvent>;
  return (
    event.type === "snapshot" &&
    typeof event.requestId === "string" &&
    typeof event.sessionEpoch === "string" &&
    typeof event.source === "string" &&
    Boolean(event.state) &&
    typeof event.state === "object"
  );
}

/** A plan is never ready "for work" — only the two planning modes apply. */
const PLANNING_PHASES: readonly FrontendWorkflowPhase[] = WORKFLOW_MODES.filter(
  (mode) => mode !== "work",
);

function isPlanReadiness(value: unknown): value is FrontendPlanReadiness {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<FrontendPlanReadiness>;
  return (
    typeof candidate.hash === "string" &&
    candidate.hash.length > 0 &&
    typeof candidate.mode === "string" &&
    PLANNING_PHASES.includes(candidate.mode as FrontendWorkflowPhase) &&
    typeof candidate.qualityOk === "boolean"
  );
}

/** Returns whether the presentation state actually changed. */
export function mergeFrontendUiState(
  state: FrontendUiState,
  patch: FrontendUiStatePatch,
): boolean {
  let changed = false;
  const workflowPhases: readonly FrontendWorkflowPhase[] = WORKFLOW_MODES;
  const activityKinds: readonly FrontendActivityKind[] = [
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
    // A mode selected during a running turn is pending, never active: the
    // running turn keeps the mode it started under, so a frontend that showed
    // `pending` as `phase` would claim a switch that has not happened.
    if ("pending" in patch.workflow) {
      const pending =
        patch.workflow.pending &&
        workflowPhases.includes(patch.workflow.pending)
          ? patch.workflow.pending
          : undefined;
      if (state.workflow.pending !== pending) {
        state.workflow.pending = pending;
        changed = true;
      }
    }
    if ("planReady" in patch.workflow) {
      const raw = patch.workflow.planReady;
      // A malformed value (garbage, or a forged `mode: "work"`) must never
      // reach `state` at all — accepting it as `null` would let bad data blank
      // out a legitimate readiness that was already there. Only `null` itself
      // (an explicit "no plan ready") or a value that actually passes the
      // shape and mode check may be assigned; anything else is dropped,
      // leaving whatever was already in state untouched.
      if (raw === null || isPlanReadiness(raw)) {
        const ready = raw;
        const current = state.workflow.planReady ?? null;
        // Optional chaining already makes every field read `undefined` on
        // either side of a null/non-null transition (`null?.hash` is
        // `undefined`, and a real object's hash is a non-empty string), so a
        // change into or out of "no plan ready" is caught by the field
        // comparisons themselves — no separate null-ness check is needed.
        // `mode` matters alongside `hash`/`qualityOk`: it is what tells a
        // frontend whether the ready plan is a Schnellplan or an
        // Architekturplan, and comparing only the other two would miss a
        // patch that changes mode alone.
        if (
          current?.hash !== ready?.hash ||
          current?.mode !== ready?.mode ||
          current?.qualityOk !== ready?.qualityOk
        ) {
          state.workflow.planReady = ready;
          changed = true;
        }
      }
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
      const id = typeof patch.model.id === "string" ? patch.model.id : undefined;
      if (state.model.id !== id) {
        state.model.id = id;
        changed = true;
      }
    }
    if ("thinking" in patch.model) {
      const thinking =
        typeof patch.model.thinking === "string" ? patch.model.thinking : undefined;
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
  if ("task" in patch) {
    const next = patch.task;
    if (
      next &&
      (state.task.title !== next.title || state.task.phaseLabel !== next.phaseLabel)
    ) {
      state.task = { ...next };
      changed = true;
    }
  }
  if ("subagents" in patch) {
    const next = patch.subagents ?? [];
    if (JSON.stringify(state.subagents) !== JSON.stringify(next)) {
      state.subagents = next;
      changed = true;
    }
  }
  return changed;
}
