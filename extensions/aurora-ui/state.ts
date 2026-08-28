import type { EventBus, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  FRONTEND_STATE_CHANNELS,
  type FrontendActivityKind,
  type FrontendSubagentBranch,
  type FrontendTask,
  type FrontendTaskChanges,
  type FrontendUiPatchEvent,
  type FrontendUiSnapshotEvent,
  type FrontendUiState,
  type FrontendUiStatePatch,
  type FrontendUiStateRequest,
  type FrontendVerificationSummary,
  type FrontendWorkflowPhase,
} from "../frontend-protocol/state-contract.ts";
import {
  isFrontendUiPatchEvent,
  isFrontendUiSnapshotEvent,
  isFrontendUiStateRequest,
  mergeFrontendUiState,
} from "../frontend-protocol/state-helpers.ts";

/**
 * Aurora-Spiegel des versionierten Frontend-Vertrags. Kanäle und Schemata
 * gehören dem neutralen frontend-protocol-Modul; diese Datei hält nur die
 * Legacy-Namen für die Aurora-internen Aufrufer sowie die Publish-/Merge-
 * Helfer. Aurora ist Konsument des Core-Bus, nicht dessen Quelle.
 */
export const AURORA_UI_CHANNELS = FRONTEND_STATE_CHANNELS;

export type AuroraWorkflowPhase = FrontendWorkflowPhase;

export type AuroraActivityKind = FrontendActivityKind;

export type AuroraTaskChanges = FrontendTaskChanges;

export type AuroraVerificationSummary = FrontendVerificationSummary;

export type AuroraSubagentBranch = FrontendSubagentBranch;

export type AuroraTask = FrontendTask;

export type AuroraUiState = FrontendUiState;

export type AuroraUiStatePatch = FrontendUiStatePatch;

export type AuroraUiStateRequest = FrontendUiStateRequest;

export type AuroraUiPatchEvent = FrontendUiPatchEvent;

export type AuroraUiSnapshotEvent = FrontendUiSnapshotEvent;

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

/** Rückwärtskompatible Aurora-Namen für neutrale Protocol-Guards. */
export const isAuroraUiStateRequest = isFrontendUiStateRequest;
export const isAuroraUiPatchEvent = isFrontendUiPatchEvent;
export const isAuroraUiSnapshotEvent = isFrontendUiSnapshotEvent;

/** Rückwärtskompatibler Aurora-Wrapper um den neutralen Merge. */
export function mergeAuroraUiState(
  state: AuroraUiState,
  patch: AuroraUiStatePatch,
): boolean {
  return mergeFrontendUiState(state, patch);
}
