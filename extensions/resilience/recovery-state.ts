/**
 * Pure Ableitung des Recovery-Gates aus Session-Einträgen.
 *
 * Das Gate ist die Schreibsperre nach einem fehlgeschlagenen oder
 * unterbrochenen Turn mit möglicher Workspace-Mutation. Seine Wahrheit liegt
 * ausschließlich in den Session-Einträgen (`recovery-required` →
 * `recovery-checked`); diese Funktionen entscheiden ohne jeden Zusatzzustand,
 * damit Guard, Tool und Tests dieselbe Quelle auswerten.
 */
import type {
  RecoveryCheckedMarker,
  RecoveryRequiredMarker,
} from "./types.ts";

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
 * Das letzte Recovery-Gate der Session-Historie: der jüngste
 * `recovery-required`-Eintrag und ein `recovery-checked` desselben Turns,
 * sofern er nach dem Required-Eintrag geschrieben wurde. Ein älteres,
 * bereits geprüftes Gate bleibt geschlossen, sobald ein neues Required
 * erscheint.
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
      gate = { required };
      continue;
    }
    const checked = customData<RecoveryCheckedMarker>(
      entry,
      "resilience.recovery-checked",
    );
    if (
      checked &&
      isRecoveryCheckedMarker(checked) &&
      gate &&
      !gate.checked &&
      checked.turnStartedAt === gate.required.turnStartedAt
    ) {
      gate = { ...gate, checked };
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

/**
 * Blockentscheidung für einen Workspace-Fingerprint. `undefined` oder
 * `"unavailable"` gilt fail-closed als geändert: Ein Gate darf nur mit einem
 * belastbaren, unveränderten Snapshot geöffnet werden.
 */
export function gateBlocked(
  gate: RecoveryGateState | undefined,
  currentFingerprint: string | undefined,
): boolean {
  if (!gate || !gateRequiresInspection(gate.required)) return false;
  if (!gate.checked) return true;
  return (
    currentFingerprint === undefined ||
    currentFingerprint === "unavailable" ||
    currentFingerprint !== gate.checked.workspaceFingerprint
  );
}
