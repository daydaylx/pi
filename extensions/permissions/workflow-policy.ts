import type { ToolCallEvent } from "@earendil-works/pi-coding-agent";
import { createRequire } from "node:module";
import { relative, resolve, sep } from "node:path";
import {
  decideFileAccess,
  isPlanModeDiagnosticCommand,
  isSensitiveReference,
  resolvePathScope,
  type ProtectedWritePath,
} from "../shared/permission-policy.ts";
import type { PermissionLevel } from "../shared/workflow-status.ts";
import type { WorkflowCapabilitySnapshot } from "../shared/workflow-capabilities.ts";
import { isPlanningMode } from "../shared/workflow-mode.ts";
import { isPlanFilePath, PLAN_RELATIVE_PATH } from "../plan-mode/plan-file.ts";
import { toolPath } from "./tool-event.ts";

/**
 * The hard boundaries that hold at every permission level, YOLO included.
 *
 * This module answers one question: must the action be refused outright? How
 * a permitted action is then handled — allowed, confirmed or blocked — belongs
 * to the active permission level and lives in tool-policy.ts and
 * shared/permission-policy.ts. The finer classification this file used to
 * compute fed the permission-grant dialog and has had no reader since that
 * dialog was removed.
 */
export interface WorkflowAssessment {
  blocked: boolean;
  reason: string;
}

export const LOCAL_LSP_TOOLS = new Set([
  "lsp_diagnostics",
  "lsp_definition",
  "lsp_references",
  "lsp_hover",
  "lsp_workspace_symbols",
]);

const WRITE_TOOLS = new Set(["write", "edit"]);

const PERMITTED: WorkflowAssessment = { blocked: false, reason: "" };

// Resolve the pi runtime installation root dynamically so the readable-docs
// boundary works on any machine. Falls back to a derived default when the env
// variable is not set, which is the common case.
function resolvePiRuntimeRoot(): string {
  if (process.env.PI_RUNTIME_ROOT) return process.env.PI_RUNTIME_ROOT;
  try {
    // Resolve the pi runtime package itself — this always points at the
    // actual installation, whether global npm, pnpm, or a linked checkout.
    const req = createRequire(import.meta.url);
    const pkgRoot = req.resolve("@earendil-works/pi-coding-agent/package.json");
    return relative("package.json", pkgRoot) === ""
      ? pkgRoot.slice(0, -"package.json".length)
      : resolve(pkgRoot, "..");
  } catch {
    // Last resort: the documented fallback path this project historically
    // used. Keep it so existing installations keep working during a
    // transition.
    return "/home/d/.npm-global/lib/node_modules/@earendil-works/pi-coding-agent";
  }
}

const EXTRA_READABLE_ROOTS = [resolvePiRuntimeRoot()];

function inside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`));
}

function isDocumentedRuntimeDocsRead(
  toolName: string,
  absolutePath: string,
): boolean {
  return (
    toolName === "read" &&
    EXTRA_READABLE_ROOTS.some((root) => inside(root, absolutePath))
  );
}

function hardBash(command: string): string | undefined {
  if (isSensitiveReference(command))
    return "Harte Secret- oder Credential-Grenze";
  if (/\b(?:sudo|su)\b/i.test(command)) return "Harte Grenze: erhöhte Rechte";
  if (
    /\b(?:apt|apt-get|dnf|yum|pacman|zypper|brew)\s+(?:install|remove|purge|update|upgrade)\b/i.test(
      command,
    )
  )
    return "Harte Systemgrenze: System-Paketoperation";
  if (
    /\b(?:curl|wget)\b[^|;&]*\|\s*(?:sudo\s+)?(?:sh|bash|zsh|dash|ksh)\b/i.test(
      command,
    )
  )
    return "Harte Grenze: Download-to-shell";
  if (/\brm\b[^;&|]*(?:^|\s)["']?\/(?:[/.])*["']?(?=\s|$)/i.test(command))
    return "Harte Grenze: Löschen des Root-Dateisystems";
  return undefined;
}

export function assessBash(command: string): WorkflowAssessment {
  const hard = hardBash(command);
  return hard ? { blocked: true, reason: hard } : PERMITTED;
}

export function assessWorkflowTool(
  event: ToolCallEvent,
  cwd: string,
): WorkflowAssessment {
  if (event.toolName === "bash")
    return assessBash(
      String((event.input as Record<string, unknown>).command ?? ""),
    );
  const path = toolPath(event);
  if (path) {
    const scope = resolvePathScope(path, cwd);
    if (isSensitiveReference(path) || scope.symlinkEscape) {
      return {
        blocked: true,
        reason: "Harte Projekt-, Symlink- oder Secret-Grenze",
      };
    }
    const outsideProject = !inside(resolve(cwd), scope.absolutePath);
    if (
      outsideProject &&
      !isDocumentedRuntimeDocsRead(event.toolName, scope.absolutePath)
    ) {
      return {
        blocked: true,
        reason: "Harte Projekt-, Symlink- oder Secret-Grenze",
      };
    }
  }
  return PERMITTED;
}

export function automaticallyAllowedInPlanMode(
  workflow: WorkflowCapabilitySnapshot,
  event: ToolCallEvent,
  cwd: string,
): boolean {
  return (
    isPlanningMode(workflow.mode) &&
    WRITE_TOOLS.has(event.toolName) &&
    isPlanFilePath(toolPath(event), cwd)
  );
}

function planFileProtectedWritePath(): ProtectedWritePath {
  return {
    matches: (rawPath, cwd) => isPlanFilePath(rawPath, cwd),
    label: PLAN_RELATIVE_PATH,
  };
}

/**
 * Plan Mode's own mutation guard, independent from the chosen permission
 * level. Plan Mode is a prompt instruction, not a lock by default (see
 * extensions/plan-mode/README.md) — but a write or a mutating bash call
 * while planning is almost always a slip, not intent. This closes that gap
 * technically for `project-write` and `confirm-all` (the levels most
 * sessions plan under). File writes reuse decideFileAccess's `readonly`
 * branch unchanged (see planModeMutationGuard below). Bash reuses
 * isPlanModeDiagnosticCommand — a Plan-Mode-specific classifier, not
 * decideBash("readonly", ...): the `readonly` permission level's bash
 * policy only allows a narrow, provably-side-effect-free command surface
 * and rejects `npm test`, `npm run typecheck/lint/verify`, and plain
 * `git diff`/`git show` outright, which made Plan Mode block ordinary
 * diagnostics along with real mutations. isPlanModeDiagnosticCommand
 * shares the same parser and hard guards (chaining, redirection, command
 * substitution, secrets, external paths, `sed -i`, file-mutating tools) and
 * only widens the npm/pnpm/yarn and git branches to admit read-only/
 * diagnostic subcommands — see its doc comment in shared/permission-policy.ts.
 * `readonly` itself needs no separate handling here: its own branch in
 * decideFileAccess/decideBash already denies everything but the plan file,
 * and this guard is skipped entirely at that level (see below). `yolo` is
 * deliberately left alone: choosing YOLO is itself an explicit, unambiguous
 * override of default safety (see docs/decisions/012-plan-mode-mutation-guard.md).
 */
export function planModeBashGuard(
  workflow: WorkflowCapabilitySnapshot,
  permissionLevel: PermissionLevel,
  command: string,
  cwd: string,
): WorkflowAssessment {
  if (!isPlanningMode(workflow.mode)) return PERMITTED;
  if (permissionLevel === "readonly" || permissionLevel === "yolo")
    return PERMITTED;
  return isPlanModeDiagnosticCommand(command, cwd)
    ? PERMITTED
    : {
        blocked: true,
        reason:
          "Planmodus: Dieses Shell-Kommando ist während der Planung nicht nachweislich rein diagnostisch (z. B. Tests, Typecheck, Lint ohne --fix, git status/diff).",
      };
}

export function planModeMutationGuard(
  workflow: WorkflowCapabilitySnapshot,
  permissionLevel: PermissionLevel,
  event: ToolCallEvent,
  cwd: string,
): WorkflowAssessment {
  if (!isPlanningMode(workflow.mode)) return PERMITTED;
  if (permissionLevel === "readonly" || permissionLevel === "yolo")
    return PERMITTED;

  if (event.toolName === "bash") {
    return planModeBashGuard(
      workflow,
      permissionLevel,
      String((event.input as Record<string, unknown>).command ?? ""),
      cwd,
    );
  }
  if (!WRITE_TOOLS.has(event.toolName)) return PERMITTED;

  const path = toolPath(event) ?? "";
  const decision = decideFileAccess("readonly", "write", path, cwd, {
    protectedWritePath: planFileProtectedWritePath(),
  });
  return decision.action === "allow"
    ? PERMITTED
    : {
        blocked: true,
        reason: `Planmodus: Schreibzugriff ist auf ${PLAN_RELATIVE_PATH} beschränkt, solange geplant wird.`,
      };
}
