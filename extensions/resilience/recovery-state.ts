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

function isRecoveryRequiredMarker(
  value: unknown,
): value is RecoveryRequiredMarker {
  if (!isRecord(value)) return false;
  return (
    typeof value.turnStartedAt === "string" &&
    (value.reason === "interrupted" || value.reason === "final_failure")
  );
}

function isRecoveryCheckedMarker(
  value: unknown,
): value is RecoveryCheckedMarker {
  if (!isRecord(value)) return false;
  return (
    typeof value.turnStartedAt === "string" &&
    typeof value.workspaceFingerprint === "string"
  );
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
  for (const entry of entries) {
    const required = customData<RecoveryRequiredMarker>(
      entry,
      "resilience.recovery-required",
    );
    if (required && isRecoveryRequiredMarker(required)) {
      gate = foldRequiredMarker(required);
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
