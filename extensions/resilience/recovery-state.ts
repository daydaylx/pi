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
    typeof value.toolMayHaveMutatedWorkspace === "boolean"
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
    value.workspaceFingerprint.length > 0
  );
}

function unknownRequiredMarker(value: unknown, index: number): RecoveryRequiredMarker {
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
    reason: candidate.reason === "final_failure" ? "final_failure" : "interrupted",
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
  return { ...gate, checked };
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
      gate = foldRequiredMarker(
        isRecoveryRequiredMarker(required)
          ? required
          : unknownRequiredMarker(required, index),
      );
      continue;
    }
    const checked = customData<RecoveryCheckedMarker>(
      entry,
      "resilience.recovery-checked",
    );
    if (checked && isRecoveryCheckedMarker(checked)) {
      gate = foldCheckedMarker(gate, checked);
    }
  }
  return gate;
}

/**
 * Ob das Gate eine Prüfung verlangt. Ein unterbrochener Turn ohne
 * Recovery-Required-Vorgänger ist fail-closed behandlungsbedürftig, weil der
 * Absturzzeitpunkt jede Mutation verdecken kann. Ein finaler Fehler ohne
 * jede Mutations- oder Änderungsspur verlangt keinen Check — die
 * Recovery-Anweisung genügt.
 */
export function gateRequiresInspection(
  required: RecoveryRequiredMarker,
): boolean {
  return (
    required.reason === "interrupted" ||
    required.toolMayHaveMutatedWorkspace ||
    required.workspaceChangedSinceTurnStart
  );
}
