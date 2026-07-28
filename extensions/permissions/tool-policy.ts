/**
 * Permission-level tool policy.
 *
 * Runs after workflow-policy: only tools the workflow did not already decide
 * on reach this layer. Pure — the generic file/bash rules live in
 * shared/permission-policy.ts and are not duplicated here.
 */
import type { ToolCallEvent } from "@earendil-works/pi-coding-agent";
import {
  decideBash,
  decideFileAccess,
  type PolicyDecision,
  type ProtectedWritePath,
} from "../shared/permission-policy.ts";
import { isPlanFilePath, PLAN_RELATIVE_PATH } from "../plan-mode/store/index.ts";
import {
  PERMISSION_LEVEL_LABEL,
  type PermissionLevel,
} from "../shared/workflow-status.ts";
import type { PolicyAction as ConfiguredPolicyAction } from "../setup-core/config.ts";
import type { WorkflowCapabilitySnapshot } from "../shared/workflow-capabilities.ts";
import {
  LOCAL_LSP_TOOLS,
  decideWorkflowTool,
  workflowAllowsPlanWrite,
} from "./workflow-policy.ts";
import { toolPath } from "./tool-event.ts";

export function permissionWarning(level: PermissionLevel): string | undefined {
  if (level === "confirm-all") {
    return "CONFIRM ALL aktiv: Jede Mutation und externe Aktion benötigt eine Bestätigung.";
  }
  if (level === "yolo") {
    return "YOLO temporär aktiv: Rückfragen entfallen; harte Secret-, System-, Symlink- und Trust-Grenzen bleiben aktiv.";
  }
  return undefined;
}

// Planning/reviewing alone may grant a write exception for the current plan.
// Outside those workflow capabilities, readonly blocks the same path.
const PROTECTED_WRITE_PATH: ProtectedWritePath = {
  matches: isPlanFilePath,
  label: PLAN_RELATIVE_PATH,
};

export function decideTool(
  permissionLevel: PermissionLevel,
  event: ToolCallEvent,
  cwd: string,
  workflow: WorkflowCapabilitySnapshot,
  configured: {
    unknownTools: ConfiguredPolicyAction;
    bash: ConfiguredPolicyAction;
  },
): PolicyDecision {
  const workflowDecision = decideWorkflowTool(workflow, event, cwd);
  if (workflowDecision) {
    if (
      permissionLevel === "confirm-all" &&
      workflowDecision.action === "allow" &&
      ["write", "edit", "subagent"].includes(event.toolName)
    ) {
      return {
        action: "ask",
        reason: `Confirm All: kontrollierte Aktion "${event.toolName}" bestätigen`,
      };
    }
    return workflowDecision;
  }

  if (event.toolName === "bash") {
    if (permissionLevel === "project-write") {
      if (configured.bash === "block") {
        return {
          action: "block",
          reason: "Bash ist in der Setup-Policy gesperrt.",
        };
      }
      if (configured.bash === "ask") {
        return {
          action: "ask",
          reason:
            "Freier Shell-Zugriff benötigt Bestätigung; nutze für Standardprüfungen das verify-Tool.",
        };
      }
    }
    return decideBash(
      permissionLevel,
      String((event.input as Record<string, unknown>).command ?? ""),
      cwd,
    );
  }

  if (
    event.toolName === "read" ||
    event.toolName === "grep" ||
    event.toolName === "find" ||
    event.toolName === "ls"
  ) {
    return decideFileAccess(
      permissionLevel,
      "read",
      toolPath(event) ?? ".",
      cwd,
    );
  }

  // Explicit capability classes for local read-only and workflow tools.
  // Custom/MCP tools are deliberately not inferred from their names except
  // for the locally owned, fixed contracts below.
  if (LOCAL_LSP_TOOLS.has(event.toolName)) {
    return { action: "allow", reason: "LSP-Fähigkeit (nur lesend)" };
  }
  if (event.toolName === "ask_user") {
    return { action: "allow", reason: "Controlled workflow capability" };
  }
  if (event.toolName === "plan_progress") {
    return permissionLevel === "confirm-all"
      ? {
          action: "ask",
          reason: "Confirm All: Sidecar-Fortschritt bestätigen",
        }
      : { action: "allow", reason: "Controlled workflow capability" };
  }
  if (event.toolName === "verify") {
    return permissionLevel === "readonly"
      ? {
          action: "block",
          reason: "Readonly: Verifikation kann Projektartefakte erzeugen.",
        }
      : permissionLevel === "confirm-all"
        ? {
            action: "ask",
            reason: "Verifikation kann Projektartefakte erzeugen.",
          }
        : { action: "allow", reason: "Allowlisted verification capability" };
  }

  if (event.toolName === "write" || event.toolName === "edit") {
    const filePath = toolPath(event) ?? "";
    return decideFileAccess(permissionLevel, "write", filePath, cwd, {
      ...(workflowAllowsPlanWrite(workflow)
        ? { protectedWritePath: PROTECTED_WRITE_PATH }
        : {}),
    });
  }

  if (permissionLevel === "yolo") {
    return {
      action: "allow",
      reason: "Temporärer YOLO-Bypass innerhalb harter Grenzen",
    };
  }

  if (permissionLevel === "readonly" && event.toolName !== "ask_user") {
    return {
      action: "block",
      reason: `${PERMISSION_LEVEL_LABEL[permissionLevel]}: Tool "${event.toolName}" ist nicht freigegeben.`,
    };
  }
  switch (configured.unknownTools) {
    case "block":
      return {
        action: "block",
        reason: `Unbekanntes Tool "${event.toolName}" ist nicht freigegeben.`,
      };
    case "ask":
      return {
        action: "ask",
        reason: `Unbekanntes Tool "${event.toolName}" benötigt Bestätigung.`,
      };
    case "allow":
      return {
        action: "ask",
        reason: `Unbekanntes Tool "${event.toolName}" wird trotz Setup-Allow einzeln bestätigt.`,
      };
  }
}
