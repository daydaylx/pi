/**
 * Compatibility Layer: Adapter zwischen dem heutigen Zustandsbus (dessen
 * Kanäle die fachlichen Extensions bereits bedienen) und dem
 * versionierten Protokollereignisformat. Aurora wird dadurch nicht zur
 * Datenquelle der GUI — beide Frontends konsumieren denselben
 * Core-seitigen Bus; dieses Modul besitzt nur die Formtransformation.
 */
import type {
  FrontendUiPatchEvent,
  FrontendUiSnapshotEvent,
  FrontendUiStatePatch,
  FrontendUiStateRequest,
} from "./state-contract.ts";
import { FRONTEND_STATE_CHANNELS } from "./state-contract.ts";

export interface ProtocolStatePatchEvent {
  type: "state.patch";
  channel: string;
  sessionEpoch: string;
  source: string;
  fields: FrontendUiStatePatch;
}

export interface ProtocolStateSnapshotEvent {
  type: "state.snapshot";
  channel: string;
  requestId: string;
  sessionEpoch: string;
  source: string;
  fields: FrontendUiStatePatch;
}

/** Bus-Patch -> versioniertes state.patch-Ereignis. */
export function auroraPatchToProtocolEvent(
  event: FrontendUiPatchEvent,
): ProtocolStatePatchEvent {
  return {
    type: "state.patch",
    channel: FRONTEND_STATE_CHANNELS.patch,
    sessionEpoch: event.sessionEpoch,
    source: event.source,
    fields: event.patch,
  };
}

/** Bus-Snapshot -> versioniertes state.snapshot-Ereignis. */
export function auroraSnapshotToProtocolEvent(
  event: FrontendUiSnapshotEvent,
): ProtocolStateSnapshotEvent {
  return {
    type: "state.snapshot",
    channel: FRONTEND_STATE_CHANNELS.snapshot,
    requestId: event.requestId,
    sessionEpoch: event.sessionEpoch,
    source: event.source,
    fields: event.state,
  };
}

/**
 * Baut die Bus-Anfrage, mit der ein beliebiges Frontend einen vollständigen
 * Snapshot seiner interessierenden Felder anfordert (Antwort kommt als
 * Snapshot-Event vom jeweiligen Provider).
 */
export function protocolStateRequest(
  requestId: string,
  sessionEpoch: string,
): FrontendUiStateRequest {
  return {
    type: "request",
    requestId,
    sessionEpoch,
    requester: "frontend-bridge/v1",
  };
}
