import type { ToolCallEvent } from "@earendil-works/pi-coding-agent";
import { relative, resolve, sep } from "node:path";
import { resolveRuntimeRoot } from "../../shared/runtime-resolution.mjs";
import { ASK_USER_TOOL_NAME } from "../shared/ask-user-policy.ts";
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
const PLAN_MODE_READ_ONLY_TOOLS = new Set([
  "read",
  "grep",
  "find",
  "ls",
  "recovery_check",
  ASK_USER_TOOL_NAME,
  // Extern read-only (pi-web-access): nur trusted wirksam, weil das
  // Trust-Gate in guards.ts vorgeschaltet ist und der Planmodus selbst im
  // untrusted Projekt gesperrt ist.
  "web_search",
  "fetch_content",
  ...LOCAL_LSP_TOOLS,
]);

const PERMITTED: WorkflowAssessment = { blocked: false, reason: "" };

// Resolve the pi runtime installation root dynamically so the readable-docs
// boundary works on any machine. Falls back to a derived default when the env
// variable is not set, which is the common case.
function resolvePiRuntimeRoot(): string | undefined {
  try {
    return resolveRuntimeRoot().root;
  } catch {
    return undefined;
  }
}

const runtimeRoot = resolvePiRuntimeRoot();
const EXTRA_READABLE_ROOTS = runtimeRoot ? [runtimeRoot] : [];

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

/**
 * A Plan-Mode delegation is safe only when it preserves the investigator
 * profile's fresh, project-local, read-only contract. The guard normalizes
 * its omitted `artifacts` flag to false before the executor starts, because
 * the package default otherwise writes debug artifacts below the project.
 */
export function planModeInvestigatorSingleAllowed(
  workflow: WorkflowCapabilitySnapshot,
  permissionLevel: PermissionLevel,
  event: ToolCallEvent,
): boolean {
  if (
    !isPlanningMode(workflow.mode) ||
    permissionLevel === "readonly" ||
    event.toolName !== "subagent"
  ) {
    return false;
  }
  const input = event.input;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return false;
  }
  const params = input as Record<string, unknown>;
  return (
    params.action === undefined &&
    params.agent === "investigator" &&
    typeof params.task === "string" &&
    params.task.trim().length > 0 &&
    (params.async === undefined || params.async === false) &&
    params.output === undefined &&
    (params.artifacts === undefined || params.artifacts === false) &&
    params.context === undefined &&
    params.cwd === undefined &&
    params.skill === undefined
  );
}

function planFileProtectedWritePath(): ProtectedWritePath {
  return {
    matches: (rawPath, cwd) => isPlanFilePath(rawPath, cwd),
    label: PLAN_RELATIVE_PATH,
  };
}

/**
 * Plan Mode permits only fixed read-only capabilities. It deliberately does
 * not infer safety from project-script names: `npm test` and `npm run build`
 * can run arbitrary lifecycle code. YOLO hebt diese Grenzen für
 * Agenten-Tool-Aufrufe nicht auf — der Planmodus bleibt auch bei aktivem
 * YOLO eine harte Schreibgrenze; nur `readonly` reicht die Entscheidung an
 * die Zugriffsstufe weiter.
 */
export function planModeBashGuard(
  workflow: WorkflowCapabilitySnapshot,
  permissionLevel: PermissionLevel,
  command: string,
  cwd: string,
): WorkflowAssessment {
  if (!isPlanningMode(workflow.mode)) return PERMITTED;
  if (permissionLevel === "readonly") return PERMITTED;
  return isPlanModeDiagnosticCommand(command, cwd)
    ? PERMITTED
    : {
        blocked: true,
        reason:
          "Planmodus: Dieses Shell-Kommando ist während der Planung nicht erlaubt. Bash ist auf git status/diff/log, rg, find sowie eine kleine Gruppe reiner Lesewerkzeuge (pwd, ls, cat, head, tail, wc, stat, du, df, tree, sort/uniq) begrenzt — keine Verkettung, keine Redirections.",
      };
}

export function planModeMutationGuard(
  workflow: WorkflowCapabilitySnapshot,
  permissionLevel: PermissionLevel,
  event: ToolCallEvent,
  cwd: string,
): WorkflowAssessment {
  if (!isPlanningMode(workflow.mode)) return PERMITTED;
  if (permissionLevel === "readonly") return PERMITTED;

  if (event.toolName === "bash") {
    return planModeBashGuard(
      workflow,
      permissionLevel,
      String((event.input as Record<string, unknown>).command ?? ""),
      cwd,
    );
  }
  if (PLAN_MODE_READ_ONLY_TOOLS.has(event.toolName)) return PERMITTED;
  if (!WRITE_TOOLS.has(event.toolName)) {
    return {
      blocked: true,
      reason:
        "Planmodus: Dieses Tool ist nicht als nachweislich lesend freigegeben.",
    };
  }

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
