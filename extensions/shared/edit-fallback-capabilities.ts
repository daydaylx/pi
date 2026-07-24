/**
 * Synchronous capability bridge between the edit-fallback detector
 * (setup-core, issue #104) and the permission extension.
 *
 * mode-permissions.ts is intentionally the only extension that intercepts
 * tool_call and decides `{block}`/`{action:"ask"}` (see the header comment
 * in mode-permissions.ts). The edit-fallback detector must not register its
 * own blocking tool_call hook; instead it publishes its current snapshot by
 * subscribing to EDIT_FALLBACK_CAPABILITY_EVENTS.request and invoking
 * respond during the event dispatch, mirroring workflow-capabilities.ts and
 * doom-loop-capabilities.ts.
 */

export const EDIT_FALLBACK_CAPABILITY_EVENTS = {
  request: "edit-fallback-capabilities:request",
} as const;

export interface EditFallbackSnapshot {
  /** "edit-retry" matches by signature; "full-rewrite" matches by path+toolName. */
  kind?: "edit-retry" | "full-rewrite";
  /** Path of the file the current advisory candidate applies to, if any. */
  blockedPath?: string;
  /** Edit signature (path + oldText) the candidate matches, if any. */
  blockedSignature?: string;
  reason?: string;
}

export interface EditFallbackCapabilityRequest {
  respond(snapshot: EditFallbackSnapshot): void;
}

export interface EditFallbackEventBus {
  emit(channel: string, value: unknown): void;
}

const DEFAULT_SNAPSHOT: EditFallbackSnapshot = {};

export function requestEditFallbackSnapshot(
  events: EditFallbackEventBus,
): EditFallbackSnapshot {
  let snapshot: EditFallbackSnapshot | undefined;
  events.emit(EDIT_FALLBACK_CAPABILITY_EVENTS.request, {
    respond(value: EditFallbackSnapshot) {
      if (!snapshot && isEditFallbackSnapshot(value)) snapshot = value;
    },
  } satisfies EditFallbackCapabilityRequest);
  return snapshot ?? DEFAULT_SNAPSHOT;
}

export function isEditFallbackSnapshot(
  value: unknown,
): value is EditFallbackSnapshot {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    (v.kind === undefined ||
      v.kind === "edit-retry" ||
      v.kind === "full-rewrite") &&
    (v.blockedPath === undefined || typeof v.blockedPath === "string") &&
    (v.blockedSignature === undefined ||
      typeof v.blockedSignature === "string") &&
    (v.reason === undefined || typeof v.reason === "string")
  );
}
