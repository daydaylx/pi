/**
 * Diagnostic-only classification of a failed check as introduced by the
 * current workspace change, pre-existing, or unknown. Never gates or
 * changes `verified`/`changed_unverified`/`checks_failed` semantics
 * (verification-status.ts) — this is evidence attached to a report, not a
 * new status.
 *
 * `introduced`/`pre_existing` are only ever returned when there is a real
 * comparison basis — not inferred from where a failure's output happens to
 * mention a path. Two genuine, zero-cost baselines are available without
 * running anything twice or touching git state:
 *
 * 1. The workspace exactly matches HEAD (no staged/unstaged/untracked
 *    changes at all). A failure here cannot have been introduced by this
 *    session — there is nothing to have introduced it. Tautological, not a
 *    heuristic.
 * 2. This exact profile has already been observed passing earlier in the
 *    same session (tracked by the caller across project_check calls). If it
 *    passed once and now fails, that is a real, recorded regression — not a
 *    guess.
 *
 * Absent both, the honest answer is `unknown`. No worktrees, no stash, no
 * re-running the check against a clean checkout — see docs/verify-profiles.md
 * for why that heavier option exists only as a possible future manual step,
 * not automation here. A cheap, explicitly non-causal `pathRelation` hint is
 * still attached to the `unknown` case: it describes whether the failure's
 * output mentions paths inside or outside the current diff, which can help
 * an agent decide where to look next, but it is never promoted to a
 * classification by itself.
 */

export type BaselineClassification = "introduced" | "pre_existing" | "unknown";

/**
 * Purely descriptive, non-causal relationship between a failure's output
 * and the current diff's changed files. Never drives `introduced`/
 * `pre_existing` on its own — see module doc comment.
 */
export type PathRelation =
  | "all_paths_changed"
  | "no_paths_changed"
  | "mixed"
  | "no_paths_found";

export interface BaselineDiagnostic {
  classification: BaselineClassification;
  reason: string;
  /** Only present when classification is "unknown". */
  pathRelation?: PathRelation;
  matchedPaths?: string[];
}

// Deliberately crude: a path-shaped token, not a real path parser. Cheap by
// design — this is descriptive context, not proof.
const PATH_TOKEN_PATTERN = /(?:[.\w-]+\/)+[.\w-]+\.\w+/g;

function pathsMatch(mentioned: string, changed: string): boolean {
  return mentioned.endsWith(changed) || changed.endsWith(mentioned);
}

function describePathRelation(
  output: string,
  changedFiles: readonly string[],
): { pathRelation: PathRelation; matchedPaths: string[] } {
  const mentioned = [
    ...new Set([...output.matchAll(PATH_TOKEN_PATTERN)].map((m) => m[0])),
  ];
  if (mentioned.length === 0) {
    return { pathRelation: "no_paths_found", matchedPaths: [] };
  }
  const matched = mentioned.filter((path) =>
    changedFiles.some((changed) => pathsMatch(path, changed)),
  );
  if (matched.length === 0) {
    return { pathRelation: "no_paths_changed", matchedPaths: [] };
  }
  if (matched.length < mentioned.length) {
    return { pathRelation: "mixed", matchedPaths: matched };
  }
  return { pathRelation: "all_paths_changed", matchedPaths: matched };
}

/**
 * @param output the failed profile's captured output (for the `unknown`
 *   case's descriptive pathRelation hint only).
 * @param changedFiles the current workspace snapshot's changed files. An
 *   empty array is itself baseline #1 above (workspace matches HEAD).
 * @param hasPassedThisSession whether this exact profile id has already
 *   been recorded succeeding earlier in the current session (baseline #2
 *   above) — the caller tracks this across project_check calls.
 */
export function classifyCheckFailure(
  output: string,
  changedFiles: readonly string[],
  hasPassedThisSession: boolean,
): BaselineDiagnostic {
  if (changedFiles.length === 0) {
    return {
      classification: "pre_existing",
      reason:
        "Workspace entspricht exakt HEAD (keine Änderungen) — ein Fehlschlag kann nicht durch die aktuelle Sitzung eingeführt worden sein.",
    };
  }
  if (hasPassedThisSession) {
    return {
      classification: "introduced",
      reason:
        "Dieses Profil lief bereits erfolgreich in dieser Sitzung; der jetzige Fehlschlag ist eine belegte Regression seit diesem Lauf.",
    };
  }
  const { pathRelation, matchedPaths } = describePathRelation(
    output,
    changedFiles,
  );
  return {
    classification: "unknown",
    reason:
      "Keine belastbare Baseline: das Profil lief in dieser Sitzung noch nicht erfolgreich, und der Workspace enthält Änderungen.",
    pathRelation,
    ...(matchedPaths.length > 0 ? { matchedPaths } : {}),
  };
}
