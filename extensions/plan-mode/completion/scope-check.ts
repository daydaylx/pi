/**
 * Technical scope evaluation.
 *
 * Pure and deterministic: it receives the already captured changed files and
 * matches them against the scope declared by the PlanSnapshot or the direct
 * task. No git execution, no formatting, no state mutation. A missing scope is
 * reported as `not_run` — an unverifiable scope must never look like a pass.
 */
import { matchScope } from "../scope.ts";
import { isSecretPath } from "./secret-boundary.ts";
import type {
  ChangedFile,
  CompletionCheck,
  CompletionPipelineContext,
} from "./types.ts";

export function deriveExpectedScope(ctx: CompletionPipelineContext): string[] {
  return ctx.plan?.technicalScope ?? ctx.directTask?.technicalScope ?? [];
}

/** Workflow artefacts the pipeline writes itself are never scope violations. */
export function isInternalWorkflowArtifact(path: string): boolean {
  return path === ".agent/direct-task.json" || path.startsWith(".agent/plans/");
}

export function evaluateScope(
  ctx: CompletionPipelineContext,
  changedFiles: readonly ChangedFile[],
): { checks: CompletionCheck[]; findings: string[] } {
  const relevant = changedFiles
    .map((file) => file.path)
    .filter((path) => !isInternalWorkflowArtifact(path) && !isSecretPath(path));
  const scope = deriveExpectedScope(ctx);
  if (scope.length === 0) {
    return {
      checks: [
        {
          name: "technical-scope",
          classification: "required",
          status: "not_run",
          summary:
            "Kein maschinenlesbarer technischer Scope; vollständige Scope-Prüfung ist unmöglich.",
        },
      ],
      findings: [
        "Technischer Scope fehlt; der Abschluss darf nicht als vollständig scope-geprüft gelten.",
      ],
    };
  }
  const matched = matchScope(scope, relevant);
  const findings: string[] = [];
  if (matched.outOfScope.length > 0) {
    findings.push(
      `Außerhalb des technischen Scopes: ${matched.outOfScope.join(", ")}`,
    );
  }
  if (matched.undeclared.length > 0) {
    findings.push(
      `Deklarierter Scope ohne Änderung: ${matched.undeclared.join(", ")}`,
    );
  }
  return {
    checks: [
      {
        name: "technical-scope",
        classification: "required",
        status: matched.outOfScope.length > 0 ? "fail" : "pass",
        summary:
          matched.outOfScope.length > 0
            ? (findings[0] as string)
            : `${matched.inScope.length} geänderte Datei(en) im Scope.`,
      },
    ],
    findings,
  };
}
