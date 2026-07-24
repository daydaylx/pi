/**
 * Synchronous capability bridge between the doom-loop detector (setup-core,
 * issue #103) and the permission extension.
 *
 * mode-permissions.ts is intentionally the only extension that intercepts
 * tool_call and decides `{block}`/`{action:"ask"}` (see the header comment
 * in mode-permissions.ts). The doom-loop detector must not register its own
 * blocking tool_call hook; instead it publishes its current snapshot by
 * subscribing to DOOM_LOOP_CAPABILITY_EVENTS.request and invoking respond
 * during the event dispatch, mirroring workflow-capabilities.ts.
 */

export const DOOM_LOOP_CAPABILITY_EVENTS = {
  request: "doom-loop-capabilities:request",
} as const;

export interface DoomLoopSnapshot {
  active: boolean;
  reason?: string;
  /** The normalised signature of the call that triggered the detection. */
  signature?: string;
  toolName?: string;
}

export interface DoomLoopCapabilityRequest {
  respond(snapshot: DoomLoopSnapshot): void;
}

export interface DoomLoopEventBus {
  emit(channel: string, value: unknown): void;
}

const DEFAULT_SNAPSHOT: DoomLoopSnapshot = { active: false };

export function requestDoomLoopSnapshot(
  events: DoomLoopEventBus,
): DoomLoopSnapshot {
  let snapshot: DoomLoopSnapshot | undefined;
  events.emit(DOOM_LOOP_CAPABILITY_EVENTS.request, {
    respond(value: DoomLoopSnapshot) {
      if (!snapshot && isDoomLoopSnapshot(value)) snapshot = value;
    },
  } satisfies DoomLoopCapabilityRequest);
  return snapshot ?? DEFAULT_SNAPSHOT;
}

export function isDoomLoopSnapshot(value: unknown): value is DoomLoopSnapshot {
  if (!value || typeof value !== "object") return false;
  return typeof (value as { active?: unknown }).active === "boolean";
}
