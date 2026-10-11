/**
 * Pure Ableitung des Recovery-Gates aus Session-Einträgen.
 *
 * Das Gate ist die Schreibsperre nach einem fehlgeschlagenen oder
 * unterbrochenen Turn mit möglicher Workspace-Mutation. Seine Wahrheit liegt
 * ausschließlich in den Session-Einträgen (`recovery-required` →
 * `recovery-checked`); diese Funktionen entscheiden ohne jeden Zusatzzustand,
 * damit Guard, Tool und Tests dieselbe Quelle auswerten.
 */
import type { RecoveryCheckedMarker, RecoveryRequiredMarker } from "./types.ts";

export interface RecoveryGateState {
  required: RecoveryRequiredMarker;
  /** Der Check, der dieses Gate geöffnet hat — falls er stattfand. */
  checked?: RecoveryCheckedMarker;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

export function customData<T>(
  entry: unknown,
  customType: string,
): T | undefined {
  if (!isRecord(entry)) return undefined;
  return entry.type === "custom" && entry.customType === customType
    ? (entry.data as T)
    : undefined;
}

function validTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    Number.isFinite(Date.parse(value))
  );
}

export function isRecoveryRequiredMarker(
  value: unknown,
): value is RecoveryRequiredMarker {
  if (!isRecord(value)) return false;
  return (
    (value.schemaVersion === 1 || value.schemaVersion === 2) &&
    validTimestamp(value.timestamp) &&
    validTimestamp(value.turnStartedAt) &&
    (value.reason === "interrupted" || value.reason === "final_failure") &&
    typeof value.workspaceChangedSinceTurnStart === "boolean" &&
    typeof value.toolMayHaveMutatedWorkspace === "boolean" &&
    (value.workspaceRoot === undefined ||
      typeof value.workspaceRoot === "string") &&
    (value.affectedRoots === undefined ||
      (Array.isArray(value.affectedRoots) &&
        value.affectedRoots.every(
          (root) =>
            isRecord(root) &&
            typeof root.workspaceRoot === "string" &&
            typeof root.workspaceChangedSinceTurnStart === "boolean" &&
            typeof root.toolMayHaveMutatedWorkspace === "boolean",
        )))
  );
}

export function isRecoveryCheckedMarker(
  value: unknown,
): value is RecoveryCheckedMarker {
  if (!isRecord(value)) return false;
  return (
    (value.schemaVersion === 1 || value.schemaVersion === 2) &&
    validTimestamp(value.timestamp) &&
    validTimestamp(value.turnStartedAt) &&
    typeof value.workspaceFingerprint === "string" &&
    value.workspaceFingerprint.length > 0 &&
    (value.workspaceRoot === undefined ||
      typeof value.workspaceRoot === "string")
  );
}

function unknownRequiredMarker(
  value: unknown,
  index: number,
): RecoveryRequiredMarker {
  const candidate = isRecord(value) ? value : {};
  const turnStartedAt = validTimestamp(candidate.turnStartedAt)
    ? candidate.turnStartedAt
    : `unknown-recovery-required-${index}`;
  return {
    schemaVersion: 2,
    timestamp: validTimestamp(candidate.timestamp)
      ? candidate.timestamp
      : "1970-01-01T00:00:00.000Z",
    turnStartedAt,
    reason:
      candidate.reason === "final_failure" ? "final_failure" : "interrupted",
    // Any invalid/unsupported marker has unknown mutation semantics. Never
    // preserve apparently safe false flags from a partially trusted record.
    workspaceChangedSinceTurnStart: true,
    toolMayHaveMutatedWorkspace: true,
  };
}

/**
 * Apply an already-parsed required marker: always replaces the gate,
 * discarding any earlier checked state — a new required window means any
 * prior check no longer proves anything about it.
 */
export function foldRequiredMarker(
  required: RecoveryRequiredMarker,
): RecoveryGateState {
  return { required };
}

/**
 * Apply an already-parsed checked marker to the current gate — always the
 * newest one wins, never only the first. Live updates (recovery_check's
 * tool execution in index.ts) and history replay (latestRecoveryGate below)
 * call this exact function, so a restart can never reconstruct a different,
 * older check than what the live session actually held: REC-002 was
 * `!gate.checked` here keeping only the first checked marker per required
 * turn, so a restart after a second, more recent check replayed the stale
 * first one instead.
 */
export function foldCheckedMarker(
  gate: RecoveryGateState | undefined,
  checked: RecoveryCheckedMarker,
): RecoveryGateState | undefined {
  if (!gate || checked.turnStartedAt !== gate.required.turnStartedAt) {
    return gate;
  }
  if (gate.required.workspaceRoot !== checked.workspaceRoot) return gate;
  return { ...gate, checked };
}

function requiredForRoot(
  marker: RecoveryRequiredMarker,
  workspaceRoot: string,
): RecoveryRequiredMarker | undefined {
  const rootState = marker.affectedRoots?.find(
    (entry) => entry.workspaceRoot === workspaceRoot,
  );
  if (marker.affectedRoots && !rootState) return undefined;
  if (marker.workspaceRoot && marker.workspaceRoot !== workspaceRoot)
    return undefined;
  return {
    ...marker,
    workspaceRoot,
    workspaceChangedSinceTurnStart:
      rootState?.workspaceChangedSinceTurnStart ??
      marker.workspaceChangedSinceTurnStart,
    toolMayHaveMutatedWorkspace:
      rootState?.toolMayHaveMutatedWorkspace ??
      marker.toolMayHaveMutatedWorkspace,
  };
}

/**
 * Das letzte Recovery-Gate der Session-Historie: der jüngste
 * `recovery-required`-Eintrag und der chronologisch neueste
 * `recovery-checked` desselben Turns, sofern er nach dem Required-Eintrag
 * geschrieben wurde. Ein älteres, bereits geprüftes Gate bleibt geschlossen,
 * sobald ein neues Required erscheint.
 */
export function latestRecoveryGate(
  entries: readonly unknown[],
  workspaceRoot?: string,
): RecoveryGateState | undefined {
  let gate: RecoveryGateState | undefined;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (
      isRecord(entry) &&
      entry.type === "custom" &&
      entry.customType === "resilience.recovery-required"
    ) {
      const required = entry.data;
      const parsed = isRecoveryRequiredMarker(required)
        ? required
        : unknownRequiredMarker(required, index);
      if (workspaceRoot !== undefined) {
        const rootRequired = requiredForRoot(parsed, workspaceRoot);
        if (rootRequired) gate = foldRequiredMarker(rootRequired);
      } else {
        gate = foldRequiredMarker(parsed);
      }
      continue;
    }
    const checked = customData<RecoveryCheckedMarker>(
      entry,
      "resilience.recovery-checked",
    );
    if (
      checked &&
      isRecoveryCheckedMarker(checked) &&
      (workspaceRoot === undefined ||
        checked.workspaceRoot === undefined ||
        checked.workspaceRoot === workspaceRoot)
    ) {
      gate = foldCheckedMarker(
        gate,
        workspaceRoot !== undefined && checked.workspaceRoot === undefined
          ? { ...checked, workspaceRoot }
          : checked,
      );
    }
  }
  return gate;
}

/**
 * Ob das Gate eine Prüfung verlangt. Ein unterbrochener Turn verlangt nur
 * dann einen Check, wenn der Workspace seit dem Start abweicht oder ein
 * freigegebener Aufruf eine Mutation hätte ausführen können. So bleibt ein
 * Abbruch in einem reinen Leseturn ohne unnötige Schreibsperre.
 */
export function gateRequiresInspection(
  required: RecoveryRequiredMarker,
): boolean {
  return (
    required.toolMayHaveMutatedWorkspace ||
    required.workspaceChangedSinceTurnStart
  );
}
