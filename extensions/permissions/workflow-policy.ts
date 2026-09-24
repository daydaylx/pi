import type { ToolCallEvent } from "@earendil-works/pi-coding-agent";
import { ASK_USER_TOOL_NAME } from "../shared/ask-user-policy.ts";
import {
  isPlanModeDiagnosticCommand,
  isSensitivePathIdentity,
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
import {
  forbiddenInteractiveCredentialPath,
  INTERACTIVE_SHELL_TOOL_NAME,
  interactiveShellCommand,
} from "../shared/interactive-shell-policy.ts";

/**
 * The hard boundaries that hold at every permission level.
 *
 * This module answers one question: must the action be refused outright? How
 * a permitted action is then handled — allowed, confirmed or blocked — belongs
 * to the active permission level and lives in tool-policy.ts and
 * shared/permission-policy.ts. The finer classification this file used to
 * compute fed the permission-grant dialog and has had no reader since that
 * dialog was removed.
 *
 * Secret/credential references and the project/symlink escape boundary hold
 * even under YOLO 1 — those protect against irreversible data exposure, not
 * against a confirmation dialog. The system-level shell boundaries (elevated
 * rights, system package operations, download-to-shell, root wipe) are
 * YOLO 1's actual bypass surface: a deliberate, narrower risk than Claude
 * Code's own bypass-permissions mode takes for granted, so YOLO here mirrors
 * that model instead of re-litigating each command by hand.
 *
 * YOLO 2 ("yolo-ask") and YOLO 3 ("yolo-full") pass every one of these
 * boundaries on to the decision layer, which asks (2) or allows (3). What
 * they never lift lives elsewhere: the trust boundary and the Plan Mode
 * write ban (guards.ts, planModeMutationGuard) and the interactive
 * credential-path guard below.
 */
export interface WorkflowAssessment {
  blocked: boolean;
  reason: string;
  /** The hard layer explicitly approved a read outside the project. */
  allowOutsideProjectRead?: boolean;
}

export const LOCAL_LSP_TOOLS = new Set([
  "lsp_diagnostics",
  "lsp_definition",
  "lsp_references",
  "lsp_hover",
  "lsp_workspace_symbols",
]);

const WRITE_TOOLS = new Set(["write", "edit"]);
const READ_ONLY_FILE_TOOLS = new Set(["read", "grep", "find", "ls"]);
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

/**
 * Appended to every hard-boundary block reason. A single denied read (a
 * skill file outside the project, a runtime doc, a symlink escape) is
 * recoverable — the agent should keep working without that one resource,
 * not treat it as a reason to abandon the whole task. Observed regression:
 * disa-hard-06 trial 1 ended the entire run after exactly one blocked read
 * of an out-of-project SKILL.md, even though the tool returned a normal,
 * structured error. This hint cannot force model behavior, only reduce the
 * chance of it recurring.
 */
const HARD_BOUNDARY_RECOVERY_HINT =
  " Dies ist kein Abbruchgrund - arbeite ohne diese Ressource weiter oder wähle einen projektinternen Pfad.";

const PERMITTED: WorkflowAssessment = { blocked: false, reason: "" };
const PERMITTED_EXTERNAL_READ: WorkflowAssessment = {
  blocked: false,
  reason: "",
  allowOutsideProjectRead: true,
};

/**
 * System-level boundaries only — not the secret/credential check, which
 * `assessBash` applies unconditionally regardless of permission level.
 */
function hardSystemBash(command: string): string | undefined {
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

/**
 * `permissionLevel` is optional so call sites that only ever run outside
 * YOLO (or don't care) can omit it; omitting it never widens what is
 * blocked, only `"yolo"` explicitly does.
 */
export function assessBash(
  command: string,
  permissionLevel?: PermissionLevel,
): WorkflowAssessment {
  // YOLO 2/3 lift the secret boundary as well: decideBash then asks (2) or
  // allows (3). YOLO 1 keeps it as a hard block.
  if (permissionLevel === "yolo-ask" || permissionLevel === "yolo-full")
    return PERMITTED;
  if (isSensitiveReference(command))
    return { blocked: true, reason: "Harte Secret- oder Credential-Grenze" };
  if (permissionLevel === "yolo") return PERMITTED;
  const hard = hardSystemBash(command);
  return hard ? { blocked: true, reason: hard } : PERMITTED;
}

function assessInteractiveShell(
  command: string,
  permissionLevel?: PermissionLevel,
): WorkflowAssessment {
  const forbidden = forbiddenInteractiveCredentialPath(command);
  // The credential-path guard holds on every level, YOLO 3 included: the
  // password of a sudo/ssh/su call is typed by the human into the terminal,
  // never passed through the model-provided command string.
  if (forbidden) return { blocked: true, reason: forbidden };
  if (permissionLevel === "yolo-ask" || permissionLevel === "yolo-full")
    return PERMITTED;
  if (isSensitiveReference(command)) {
    return { blocked: true, reason: "Harte Secret- oder Credential-Grenze" };
  }
  if (permissionLevel === "yolo") return PERMITTED;
  const hard = hardSystemBash(command);
  if (!hard) return PERMITTED;
  // Elevated rights are intentionally allowed to reach decideBash(), where
  // project-write/confirm-all asks and headless/YOLO deny. Other hard system
  // boundaries remain blocked before execution.
  if (
    hard === "Harte Grenze: erhöhte Rechte" &&
    /\b(?:sudo|su)\b/i.test(command)
  ) {
    return PERMITTED;
  }
  return { blocked: true, reason: hard };
}

export function assessWorkflowTool(
  event: ToolCallEvent,
  cwd: string,
  permissionLevel?: PermissionLevel,
): WorkflowAssessment {
  if (event.toolName === INTERACTIVE_SHELL_TOOL_NAME)
    return assessInteractiveShell(
      interactiveShellCommand(event),
      permissionLevel,
    );
  if (event.toolName === "bash")
    return assessBash(
      String((event.input as Record<string, unknown>).command ?? ""),
      permissionLevel,
    );
  const path = toolPath(event);
  // YOLO 2/3: file targets outside the project or on secrets are decided by
  // decideFileAccess (ask / allow) instead of being blocked here.
  if (
    path &&
    permissionLevel !== "yolo-ask" &&
    permissionLevel !== "yolo-full"
  ) {
    const identity = resolvePathScope(path, cwd);
    const isReadFileTool = READ_ONLY_FILE_TOOLS.has(event.toolName);

    if (
      isSensitivePathIdentity(path, identity) ||
      identity.scope === "unresolved" ||
      identity.targetKind === "other"
    ) {
      return {
        blocked: true,
        reason:
          "Harte Projekt-, Symlink- oder Secret-Grenze." +
          HARD_BOUNDARY_RECOVERY_HINT,
      };
    }

    if (isReadFileTool) {
      // Normales Lesen ist global: externe Pfade und Symlinks auf externe
      // harmlose Dateien sind auf allen regulären Stufen lesbar (solange
      // nicht sensitiv / Secret).
      if (identity.scope === "external" || identity.symlinkEscape) {
        return PERMITTED_EXTERNAL_READ;
      }
      return PERMITTED;
    }

    // Für mutierende Tools (write, edit) oder unbekannte Pfad-Tools bleibt
    // die Projektgrenze und die Symlink-Escape-Grenze eine harte Barriere.
    if (identity.symlinkEscape || identity.scope !== "project") {
      return {
        blocked: true,
        reason:
          "Harte Projekt-, Symlink- oder Secret-Grenze." +
          HARD_BOUNDARY_RECOVERY_HINT,
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
      : "Planmodus: Dieses Shell-Kommando ist während der Planung nicht erlaubt. Bash ist auf sicher klassifizierte git status/diff/log-Aufrufe, rg, find sowie eine kleine Gruppe reiner Lesewerkzeuge (pwd, ls, cat, head, tail, wc, stat, du, df, tree, sort/uniq) begrenzt — keine Pipelines, Verkettungen oder Redirections.",
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

  if (
    event.toolName === "bash" ||
    event.toolName === INTERACTIVE_SHELL_TOOL_NAME
  ) {
    return planModeBashGuard(
      workflow,
      permissionLevel,
      event.toolName === INTERACTIVE_SHELL_TOOL_NAME
        ? interactiveShellCommand(event)
        : String((event.input as Record<string, unknown>).command ?? ""),
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
  if (
    isWorkflowStateUnknown(workflow) &&
    UNIVERSAL_READ_TOOLS.has(event.toolName)
  )
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
