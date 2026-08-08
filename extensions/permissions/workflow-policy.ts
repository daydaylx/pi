import type { ToolCallEvent } from "@earendil-works/pi-coding-agent";
import { relative, resolve, sep } from "node:path";
import {
  decideBash,
  decideFileAccess,
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

function inside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`));
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
    if (
      isSensitiveReference(path) ||
      scope.symlinkEscape ||
      !inside(resolve(cwd), scope.absolutePath)
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
 * extensions/plan-mode/README.md) — but a write or a write-capable bash call
 * while planning is almost always a slip, not intent. This closes that gap
 * technically for `project-write` and `confirm-all` (the levels most
 * sessions plan under) by reusing the exact decision functions the
 * `readonly` permission level already relies on elsewhere in this module —
 * no new pattern list, no new state. `readonly` itself needs no separate
 * handling here: its own branch in decideFileAccess/decideBash already
 * denies everything but the plan file. `yolo` is deliberately left alone:
 * choosing YOLO is itself an explicit, unambiguous override of default
 * safety (see docs/decisions/012-plan-mode-mutation-guard.md).
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
  const decision = decideBash("readonly", command, cwd);
  return decision.action === "allow"
    ? PERMITTED
    : {
        blocked: true,
        reason:
          "Planmodus: Dieses Shell-Kommando ist während der Planung nicht nachweislich rein inspizierend.",
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
