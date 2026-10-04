import type { ToolCallEvent } from "@earendil-works/pi-coding-agent";
import { ASK_USER_TOOL_NAME } from "../shared/ask-user-policy.ts";
import {
  diagnosePlanModeCommand,
  type PlanModeCommandDiagnosis,
  isSensitivePathIdentity,
  isSensitiveReference,
  resolvePathScope,
} from "../shared/permission-policy.ts";
import type { PermissionLevel } from "../shared/workflow-status.ts";
import {
  isPlanRestricted,
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
 * boundaries on to the decision layer, which asks (2) or allows (3). YOLO 3
 * also lifts the trust, recovery, Plan Mode and interactive credential-path
 * gates. Those remain in place for every other permission level.
 */
export interface WorkflowAssessment {
  blocked: boolean;
  reason: string;
  /** The hard layer explicitly approved a read outside the project. */
  allowOutsideProjectRead?: boolean;
  /**
   * Why Plan Mode refused a shell command, for tests and debugging: the
   * command's effect is not allowed, or its program could not be verified as a
   * trusted system program.
   */
  planModeCause?: "command-not-allowed" | "executable-untrusted";
}

export const LOCAL_LSP_TOOLS = new Set([
  "lsp_diagnostics",
  "lsp_definition",
  "lsp_references",
  "lsp_hover",
  "lsp_workspace_symbols",
]);

const WRITE_TOOLS = new Set(["write", "edit", "project_check", "subagent"]);
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
 * blocked, only an explicitly selected YOLO level changes the decision.
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
  // YOLO 3 is an explicit bypass of all command-level permission checks.
  if (forbidden && permissionLevel !== "yolo-full")
    return { blocked: true, reason: forbidden };
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
  if (!isPlanRestricted(workflow) || event.toolName !== "verify") {
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
 * Plan Mode blocks effects classified as mutating/risky/forbidden. Shell
 * commands are classified by their effects, not by a fixed executable
 * allowlist; unknown tool capabilities are delegated to the active permission
 * level rather than being blocked solely because they are new.
 */
export function planModeBashGuard(
  workflow: WorkflowCapabilitySnapshot,
  permissionLevel: PermissionLevel,
  command: string,
  cwd: string,
): WorkflowAssessment {
  if (!isPlanRestricted(workflow)) return PERMITTED;
  if (permissionLevel === "readonly") return PERMITTED;
  const diagnosis = diagnosePlanModeCommand(command, cwd);
  if (diagnosis.safe) return PERMITTED;
  if (diagnosis.cause === "executable-untrusted") {
    const where = diagnosis.path ? `: ${diagnosis.path}` : "";
    return {
      blocked: true,
      planModeCause: diagnosis.cause,
      reason: `Planmodus: Das Programm „${diagnosis.executable}“ wird im Planmodus nicht gestartet (${EXECUTABLE_UNTRUSTED_DETAIL[diagnosis.reason]}${where}). Projektlokale Programme gelten nicht als vertrauenswürdig; Systemprogramme und eigene Installationen sind erlaubt.`,
    };
  }
  return {
    blocked: true,
    planModeCause: diagnosis.cause,
    reason:
      "Planmodus: Dieses Shell-Kommando kann mutieren oder ist als riskant klassifiziert; Shell-Schreibzugriffe und sensible Aktionen sind während der Planung gesperrt.",
  };
}

const EXECUTABLE_UNTRUSTED_DETAIL: Record<
  Extract<
    PlanModeCommandDiagnosis,
    { cause: "executable-untrusted" }
  >["reason"],
  string
> = {
  "project-controlled": "erster PATH-Treffer liegt im Projekt",
  "relative-path": "relativer Programmpfad",
  "env-override": "Umgebungsvariable verändert die Programmsuche",
};

export function planModeMutationGuard(
  workflow: WorkflowCapabilitySnapshot,
  permissionLevel: PermissionLevel,
  event: ToolCallEvent,
  cwd: string,
): WorkflowAssessment {
  if (!isPlanRestricted(workflow)) return PERMITTED;
  if (permissionLevel === "yolo-full") return PERMITTED;
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
  if (PLAN_MODE_READ_ONLY_TOOLS.has(event.toolName)) return PERMITTED;
  if (planModeVerifyTypecheckAllowed(workflow, event)) return PERMITTED;
  if (WRITE_TOOLS.has(event.toolName) || event.toolName === "verify") {
    return {
      blocked: true,
      reason:
        "Planmodus: Dieses Tool kann Projektzustand verändern oder Code ausführen. Der Plan selbst wird ausschließlich über plan_write gespeichert.",
    };
  }
  // Capability is not inferred from a tool's name. Let the configured
  // permission level handle newly introduced tools instead of denying them
  // merely because this module has not learned their contract yet.
  return PERMITTED;
}
