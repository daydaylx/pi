import type { ToolCallEvent } from "@earendil-works/pi-coding-agent";
import {
  isSensitivePathIdentity,
  isSensitiveReference,
  resolvePathScope,
} from "../shared/permission-policy.ts";
import type { PermissionLevel } from "../shared/workflow-status.ts";
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
 * also lifts the trust and interactive credential-path gates.
 * Those remain in place for every other permission level.
 */
export interface WorkflowAssessment {
  blocked: boolean;
  reason: string;
  /** The hard layer explicitly approved a read outside the project. */
  allowOutsideProjectRead?: boolean;
}

export const LOCAL_LSP_TOOLS = new Set(["lsp_diagnostics"]);

const READ_ONLY_FILE_TOOLS = new Set(["read", "grep", "find", "ls"]);

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
  additionalRoots: readonly string[] = [],
  systemFileRoots: readonly string[] = [],
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
  // `workspace_add.path` is the directory the user is being asked to approve,
  // not a file target that the current WorkspaceScope should already allow.
  // The permission session canonicalizes it and requests explicit UI approval.
  if (event.toolName === "workspace_add") return PERMITTED;
  const path = toolPath(event);
  // YOLO 2/3: file targets outside the project or on secrets are decided by
  // decideFileAccess (ask / allow) instead of being blocked here.
  if (
    path &&
    permissionLevel !== "yolo-ask" &&
    permissionLevel !== "yolo-full"
  ) {
    const identity = resolvePathScope(path, cwd, [
      ...additionalRoots,
      ...systemFileRoots,
    ]);
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
