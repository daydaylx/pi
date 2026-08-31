import type { EventBus, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  FRONTEND_STATE_CHANNELS,
  type FrontendActivityKind as ContractFrontendActivityKind,
  type FrontendSubagentBranch as ContractFrontendSubagentBranch,
  type FrontendTask as ContractFrontendTask,
  type FrontendTaskChanges as ContractFrontendTaskChanges,
  type FrontendUiPatchEvent as ContractFrontendUiPatchEvent,
  type FrontendUiSnapshotEvent as ContractFrontendUiSnapshotEvent,
  type FrontendUiState as ContractFrontendUiState,
  type FrontendUiStatePatch as ContractFrontendUiStatePatch,
  type FrontendUiStateRequest as ContractFrontendUiStateRequest,
  type FrontendVerificationSummary as ContractFrontendVerificationSummary,
  type FrontendWorkflowPhase as ContractFrontendWorkflowPhase,
} from "./state-contract.ts";
import {
  isFrontendUiPatchEvent,
  isFrontendUiSnapshotEvent,
  isFrontendUiStateRequest,
  mergeFrontendUiState as mergeFrontendUiStateInternal,
} from "./state-helpers.ts";

/**
 * Neutraler Core-State-Bus. Presentation layers consume these channels, but
 * neither Aurora nor the Desktop renderer owns them.
 */
export const FRONTEND_UI_CHANNELS = FRONTEND_STATE_CHANNELS;
export type FrontendWorkflowPhase = ContractFrontendWorkflowPhase;
export type FrontendActivityKind = ContractFrontendActivityKind;
export type FrontendTaskChanges = ContractFrontendTaskChanges;
export type FrontendVerificationSummary = ContractFrontendVerificationSummary;
export type FrontendSubagentBranch = ContractFrontendSubagentBranch;
export type FrontendTask = ContractFrontendTask;
export type FrontendUiState = ContractFrontendUiState;
export type FrontendUiStatePatch = ContractFrontendUiStatePatch;
export type FrontendUiStateRequest = ContractFrontendUiStateRequest;
export type FrontendUiPatchEvent = ContractFrontendUiPatchEvent;
export type FrontendUiSnapshotEvent = ContractFrontendUiSnapshotEvent;

function emit(bus: EventBus, channel: string, value: unknown): void {
  bus.emit(channel, value);
}

export function publishFrontendUiPatch(
  pi: Pick<ExtensionAPI, "events">,
  sessionEpoch: string,
  source: string,
  patch: FrontendUiStatePatch,
): void {
  emit(pi.events, FRONTEND_UI_CHANNELS.patch, {
    type: "patch",
    sessionEpoch,
    source,
    patch,
  } satisfies FrontendUiPatchEvent);
}

export function publishFrontendUiSnapshot(
  pi: Pick<ExtensionAPI, "events">,
  request: FrontendUiStateRequest,
  source: string,
  state: FrontendUiStatePatch,
): void {
  emit(pi.events, FRONTEND_UI_CHANNELS.snapshot, {
    type: "snapshot",
    requestId: request.requestId,
    sessionEpoch: request.sessionEpoch,
    source,
    state,
  } satisfies FrontendUiSnapshotEvent);
}

export { isFrontendUiPatchEvent, isFrontendUiSnapshotEvent, isFrontendUiStateRequest };

export function mergeFrontendUiState(
  state: FrontendUiState,
  patch: FrontendUiStatePatch,
): boolean {
  return mergeFrontendUiStateInternal(state, patch);
}
