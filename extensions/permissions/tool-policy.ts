/**
 * Permission-level tool policy.
 *
 * Runs after workflow-policy: only tools the workflow did not already decide
 * on reach this layer. Pure — the generic file/bash rules live in
 * shared/permission-policy.ts and are not duplicated here.
 */
import type { ToolCallEvent } from "@earendil-works/pi-coding-agent";
import { ASK_USER_TOOL_NAME } from "../shared/ask-user-policy.ts";
import {
  decideBash,
  decideFileAccess,
  type PolicyDecision,
} from "../shared/permission-policy.ts";
import {
  PERMISSION_LEVEL_LABEL,
  type PermissionLevel,
} from "../shared/workflow-status.ts";
import type { PolicyAction as ConfiguredPolicyAction } from "../setup-core/config.ts";
import { WEB_TOOLS, decideWebTool } from "./web-tools.ts";
import { LOCAL_LSP_TOOLS } from "./workflow-policy.ts";
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

export function decideTool(
  permissionLevel: PermissionLevel,
  event: ToolCallEvent,
  cwd: string,
  configured: {
    unknownTools: ConfiguredPolicyAction;
    bash: ConfiguredPolicyAction;
  },
): PolicyDecision {
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
  // The LSP request itself is read-only, but answering it starts a language
  // server. This blanket allow therefore only holds because lsp/config.ts binds
  // a profile's `command` to the built-in server or the project's own
  // node_modules/.bin — a project cannot name the binary that gets spawned.
  if (LOCAL_LSP_TOOLS.has(event.toolName)) {
    return { action: "allow", reason: "LSP-Fähigkeit (nur lesend)" };
  }
  if (event.toolName === ASK_USER_TOOL_NAME) {
    return { action: "allow", reason: "Controlled workflow capability" };
  }
  if (event.toolName === "recovery_check") {
    // Der Recovery-Check ist die einzige Möglichkeit, das Recovery-Gate zu
    // öffnen; er ist read-only und darf niemals hinter einem Dialog stehen.
    return { action: "allow", reason: "Read-only-Recovery-Check" };
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

  if (WEB_TOOLS.has(event.toolName)) {
    // Externe Websuche/Fetch: gleiche Stufenlogik wie verify. Die harte
    // Trust-Grenze in guards.ts läuft vorher und blockiert im untrusted
    // Projekt; Eingabegrenzen prüft assessWebToolInput.
    return decideWebTool(permissionLevel);
  }

  if (event.toolName === "write" || event.toolName === "edit") {
    const filePath = toolPath(event) ?? "";
    return decideFileAccess(permissionLevel, "write", filePath, cwd);
  }

  if (permissionLevel === "yolo") {
    return {
      action: "allow",
      reason: "Temporärer YOLO-Bypass innerhalb harter Grenzen",
    };
  }

  if (permissionLevel === "readonly") {
    return {
      action: "block",
      reason: `${PERMISSION_LEVEL_LABEL[permissionLevel]}: Tool "${event.toolName}" ist nicht freigegeben.`,
    };
  }
  // Delegation ohne Bestätigungsdialog; readonly bleibt bewusst gesperrt,
  // weil Kind-Läufe eigene Pi-Prozesse sind und nicht beweisbar read-only.
  if (event.toolName === "subagent") {
    return {
      action: "allow",
      reason: "Subagenten-Delegation ist ohne Bestätigung erlaubt",
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
