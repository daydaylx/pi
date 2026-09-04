import type { ToolCallEvent } from "@earendil-works/pi-coding-agent";
import { relative, resolve, sep } from "node:path";
import { resolveRuntimeRoot } from "../../shared/runtime-resolution.mjs";
import { ASK_USER_TOOL_NAME } from "../shared/ask-user-policy.ts";
import {
  isPlanModeDiagnosticCommand,
  isSensitiveReference,
  resolvePathScope,
} from "../shared/permission-policy.ts";
import type { PermissionLevel } from "../shared/workflow-status.ts";
import {
  isPlanRestricted,
  isWorkflowStateUnknown,
  type WorkflowCapabilitySnapshot,
} from "../shared/workflow-capabilities.ts";
import { PLAN_WRITE_TOOL_NAME } from "../plan-mode/plan-tool.ts";
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
/**
 * Tools plan mode allows. `plan_write` is the plan's only writer and owns its
 * own destination inside the runtime's session storage, so it needs no
 * exception in the project-file write ban — unlike the old plan file, which
 * required exactly such a hole.
 */
const PLAN_MODE_READ_ONLY_TOOLS = new Set([
  PLAN_WRITE_TOOL_NAME,
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

/** Read-only in every workflow mode, so safe even with no workflow provider. */
const UNIVERSAL_READ_TOOLS = new Set([
  "read",
  "grep",
  "find",
  "ls",
  "recovery_check",
  ASK_USER_TOOL_NAME,
  ...LOCAL_LSP_TOOLS,
]);

const UNKNOWN_WORKFLOW_REASON =
  "Workflow-Zustand nicht verfügbar: Keine Workflow-Extension hat den aktuellen Modus gemeldet. Solange unklar ist, ob geplant oder gearbeitet wird, bleiben mutierende und nicht nachweislich lesende Tools gesperrt (fail-closed). Prüfe, ob extensions/plan-mode/index.ts geladen ist.";

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
    !isPlanRestricted(workflow) ||
    // An unknown workflow state must not unlock a delegation either.
    isWorkflowStateUnknown(workflow) ||
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
    params.chain === undefined &&
    params.tasks === undefined &&
    params.config === undefined &&
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

/**
 * `verify({ check: "typecheck" })` never writes: extensions/setup-core runs
 * it with the setup's fixed typecheck command (--noEmit semantics), and
 * Plan Mode is only reachable in a trusted project (see
 * `switchMode`/`isProjectTrusted` in plan-mode/commands.ts), so a
 * project-configured typecheck command carries no extra risk here that
 * trust hasn't already accepted. `check: "test"` stays blocked: a test run
 * can write coverage or snapshot files, which Plan Mode's read-only
 * contract must not permit.
 */
export function planModeVerifyTypecheckAllowed(
  workflow: WorkflowCapabilitySnapshot,
  event: ToolCallEvent,
): boolean {
  if (
    !isPlanRestricted(workflow) ||
    isWorkflowStateUnknown(workflow) ||
    event.toolName !== "verify"
  ) {
    return false;
  }
  const input = event.input;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return false;
  }
  const params = input as Record<string, unknown>;
  return params.check === "typecheck" && Object.keys(params).length === 1;
}

/**
 * Plan Mode permits only fixed read-only capabilities. It deliberately does
 * not infer safety from project-script names: `npm test` and `npm run build`
 * can run arbitrary lifecycle code. YOLO hebt diese Grenzen für
 * Agenten-Tool-Aufrufe nicht auf — der Planmodus bleibt auch bei aktivem
 * YOLO eine harte Schreibgrenze; nur `readonly` reicht die Entscheidung an
 * die Zugriffsstufe weiter.
 *
 * Ein unbekannter Workflow-Zustand (kein Provider hat geantwortet) wird wie
 * der Planmodus behandelt: fail-closed statt stillschweigend nach `work`.
 */
export function planModeBashGuard(
  workflow: WorkflowCapabilitySnapshot,
  permissionLevel: PermissionLevel,
  command: string,
  cwd: string,
): WorkflowAssessment {
  if (!isPlanRestricted(workflow)) return PERMITTED;
  if (permissionLevel === "readonly") return PERMITTED;
  if (isPlanModeDiagnosticCommand(command, cwd)) return PERMITTED;
  return {
    blocked: true,
    reason: isWorkflowStateUnknown(workflow)
      ? UNKNOWN_WORKFLOW_REASON
      : "Planmodus: Dieses Shell-Kommando ist während der Planung nicht erlaubt. Bash ist auf git status/diff/log, rg, find sowie eine kleine Gruppe reiner Lesewerkzeuge (pwd, ls, cat, head, tail, wc, stat, du, df, tree, sort/uniq) begrenzt — keine Verkettung, keine Redirections.",
  };
}

export function planModeMutationGuard(
  workflow: WorkflowCapabilitySnapshot,
  permissionLevel: PermissionLevel,
  event: ToolCallEvent,
  cwd: string,
): WorkflowAssessment {
  if (!isPlanRestricted(workflow)) return PERMITTED;
  if (permissionLevel === "readonly") return PERMITTED;

  if (event.toolName === "bash") {
    return planModeBashGuard(
      workflow,
      permissionLevel,
      String((event.input as Record<string, unknown>).command ?? ""),
      cwd,
    );
  }
  if (
    !isWorkflowStateUnknown(workflow) &&
    PLAN_MODE_READ_ONLY_TOOLS.has(event.toolName)
  )
    return PERMITTED;
  // With no workflow provider, only the tools that are read-only in every mode
  // stay available; plan-mode's own additions (plan_write, the investigator
  // exception, verify(typecheck)) require a state someone actually vouched for.
  if (isWorkflowStateUnknown(workflow) && UNIVERSAL_READ_TOOLS.has(event.toolName))
    return PERMITTED;
  if (planModeVerifyTypecheckAllowed(workflow, event)) return PERMITTED;
  return {
    blocked: true,
    reason: isWorkflowStateUnknown(workflow)
      ? UNKNOWN_WORKFLOW_REASON
      : WRITE_TOOLS.has(event.toolName)
        ? "Planmodus: Der Agent schreibt während der Planung keine Projektdateien. Der Plan selbst wird ausschließlich über plan_write gespeichert."
        : "Planmodus: Dieses Tool ist nicht als nachweislich lesend freigegeben.",
  };
}
