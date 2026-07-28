/**
 * The hard secret/auth boundary of the completion pipeline (Umbauvertrag §13.2).
 *
 * This boundary is the one completion result that is never overridable, so the
 * predicate lives in exactly one place: diff evidence needs it before hashing,
 * scope checking needs it before reporting paths, and the orchestrator needs
 * it to decide whether the diff may reach the reviewer at all.
 */
import { isSensitiveReference } from "../../shared/permission-policy.ts";
import type { ChangedFile, CompletionCheck } from "./types.ts";

export function isSecretPath(path: string): boolean {
  return isSensitiveReference(path.replace(/\\/g, "/"));
}

export function hardBoundaryCheck(
  changedFiles: readonly ChangedFile[],
): CompletionCheck {
  const secretPaths = changedFiles
    .map((file) => file.path.replace(/\\/g, "/"))
    .filter(isSecretPath);
  return {
    name: "hard-boundaries",
    classification: "required",
    status: secretPaths.length > 0 ? "fail" : "pass",
    summary:
      secretPaths.length > 0
        ? `${secretPaths.length} potenzielle Secret-/Auth-Datei(en) im Diff; Pfade werden nicht berichtet.`
        : "Keine Secret-/Auth-Pfade im Diff erkannt.",
  };
}
