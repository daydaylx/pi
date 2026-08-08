/**
 * Diagnostic-only classification of a failed check as introduced by the
 * current workspace change, pre-existing, or unknown. Never gates or
 * changes `verified`/`changed_unverified`/`checks_failed` semantics
 * (verification-status.ts) — this is evidence attached to a report, not a
 * new status. Deliberately cheap: no re-running the check against a clean
 * baseline (see docs/verify-profiles.md for why).
 */

export type BaselineClassification = "introduced" | "pre_existing" | "unknown";

export interface BaselineDiagnostic {
  classification: BaselineClassification;
  matchedPaths: string[];
  reason: string;
}

// Deliberately crude: a path-shaped token, not a real path parser. Cheap by
// design — this is a diagnostic hint, not a proof.
const PATH_TOKEN_PATTERN = /(?:[.\w-]+\/)+[.\w-]+\.\w+/g;

function pathsMatch(mentioned: string, changed: string): boolean {
  return mentioned.endsWith(changed) || changed.endsWith(mentioned);
}

export function classifyCheckFailure(
  output: string,
  changedFiles: readonly string[],
): BaselineDiagnostic {
  if (changedFiles.length === 0) {
    return {
      classification: "pre_existing",
      matchedPaths: [],
      reason: "Workspace-Snapshot enthält keine Änderungen.",
    };
  }

  const mentioned = [...new Set([...output.matchAll(PATH_TOKEN_PATTERN)].map((m) => m[0]))];
  if (mentioned.length === 0) {
    return {
      classification: "unknown",
      matchedPaths: [],
      reason: "Keine Dateipfade in der Ausgabe erkannt.",
    };
  }

  const matched = mentioned.filter((path) =>
    changedFiles.some((changed) => pathsMatch(path, changed)),
  );

  if (matched.length === 0) {
    return {
      classification: "pre_existing",
      matchedPaths: [],
      reason: "Referenzierte Pfade liegen außerhalb der Snapshot-Änderungen.",
    };
  }
  if (matched.length < mentioned.length) {
    return {
      classification: "unknown",
      matchedPaths: matched,
      reason: "Sowohl geänderte als auch unveränderte Pfade referenziert.",
    };
  }
  return {
    classification: "introduced",
    matchedPaths: matched,
    reason: "Alle referenzierten Pfade sind Teil der aktuellen Änderung.",
  };
}
