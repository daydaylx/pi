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
  isYoloLevel,
  type PermissionLevel,
} from "../shared/workflow-status.ts";
import type { PolicyAction as ConfiguredPolicyAction } from "../setup-core/config.ts";
import { WEB_TOOLS, decideWebTool } from "./web-tools.ts";
import { LOCAL_LSP_TOOLS } from "./workflow-policy.ts";
import { toolPath } from "./tool-event.ts";
import { getPiLaunchProfile } from "../shared/profile.ts";
import { systemOpenBashRisk } from "./system-open-policy.ts";
import { systemBashNeedsApproval } from "../system-control/policy.ts";
import {
  SYSTEM_CONTROL_JOB_TOOLS,
  SYSTEM_CONTROL_PRIVILEGED_TOOLS,
  SYSTEM_CONTROL_READ_TOOLS,
  SYSTEM_CONTROL_USER_MUTATION_TOOLS,
} from "../system-control/tool-names.ts";
import {
  INTERACTIVE_SHELL_TOOL_NAME,
  interactiveShellCommand,
} from "../shared/interactive-shell-policy.ts";

export function permissionWarning(level: PermissionLevel): string | undefined {
  if (level === "confirm-all") {
    return "CONFIRM ALL aktiv: Jede Mutation und externe Aktion benötigt eine Bestätigung.";
  }
  if (level === "yolo") {
    return "YOLO temporär aktiv: Routine-Rückfragen und Commit-Verifier-Pflicht entfallen, harte System-Bash-Grenzen (sudo, Paketmanager, curl|sh, rm -rf /) sind gelockert; Recovery-Gate, Secret-, Symlink- und Trust-Grenzen bleiben aktiv.";
  }
  if (level === "yolo-ask") {
    return "YOLO 2 temporär aktiv: wie YOLO 1 ohne Routine-Rückfragen, aber sudo, Systempfade, Secrets, Pfade außerhalb des Projekts und opake Interpreter fragen einzeln nach. Das Recovery-Gate bleibt aktiv; die Commit-Verifier-Pflicht entfällt. Die Trust-Grenze bleibt aktiv.";
  }
  if (level === "yolo-full") {
    return "YOLO 3 temporär aktiv: VOLLZUGRIFF ohne Rückfragen, auch sudo, Partitionen, Systempfade, Secrets und Pfade außerhalb des Projekts. Trust- und Recovery-Sperren sowie Root-Dateisystem-Löschung sind freigegeben. Tatsächliche Root-Rechte hängen von den OS-Rechten des Pi-Prozesses und sudo ab.";
  }
  if (level === "headless") {
    return "Headless aktiv: kein Bestätigungsdialog verfügbar. Projektlokale Builds/Tests/Lint/Typecheck sind erlaubt; jede sonst bestätigungspflichtige Aktion bricht strukturiert ab statt zu fragen.";
  }
  return undefined;
}

function decideToolBase(
  permissionLevel: PermissionLevel,
  event: ToolCallEvent,
  cwd: string,
  configured: {
    unknownTools: ConfiguredPolicyAction;
    bash: ConfiguredPolicyAction;
  },
  options: {
    allowOutsideProjectRead?: boolean;
    additionalRoots?: readonly string[];
    systemFileRoots?: readonly string[];
  } = {},
): PolicyDecision {
  // Tool classes are authorization by name and permission level, not by the
  // launch profile: the same typed tools ask (or are blocked) identically in
  // `pi` and `pis`. The profile label grants nothing.
  {
    if (SYSTEM_CONTROL_JOB_TOOLS.has(event.toolName)) {
      const action = (event.input as Record<string, unknown>).action;
      if (action === "status" || action === "output")
        return {
          action: "allow",
          reason: "Systemprofil: read-only Systemwerkzeug",
        };
      if (action !== "stop")
        return { action: "block", reason: "Unbekannte Systemauftrag-Aktion." };
    }
    if (SYSTEM_CONTROL_READ_TOOLS.has(event.toolName))
      return {
        action: "allow",
        reason: "Systemprofil: read-only Systemwerkzeug",
      };
    if (
      SYSTEM_CONTROL_USER_MUTATION_TOOLS.has(event.toolName) ||
      SYSTEM_CONTROL_JOB_TOOLS.has(event.toolName)
    )
      return permissionLevel === "readonly" || permissionLevel === "headless"
        ? {
            action: "block",
            reason: "Systemwerkzeug benötigt eine interaktive Freigabe.",
          }
        : {
            action: "ask",
            reason: "Systemwerkzeug verändert den Benutzerzustand.",
          };
    if (SYSTEM_CONTROL_PRIVILEGED_TOOLS.has(event.toolName))
      return permissionLevel === "readonly" || permissionLevel === "headless"
        ? {
            action: "block",
            reason:
              "Privilegiertes Systemwerkzeug ist in diesem Modus gesperrt.",
          }
        : {
            action: "ask",
            reason: "Privilegierte NixOS-Aktion benötigt eine Freigabe.",
          };
  }
  if (
    event.toolName === "bash" ||
    event.toolName === INTERACTIVE_SHELL_TOOL_NAME
  ) {
    if (permissionLevel === "project-write" || permissionLevel === "headless") {
      if (configured.bash === "block") {
        return {
          action: "block",
          reason: "Bash ist in der Setup-Policy gesperrt.",
        };
      }
      if (configured.bash === "ask") {
        return permissionLevel === "headless"
          ? {
              action: "block",
              reason:
                "Freier Shell-Zugriff benötigt eine Bestätigung, die im Headless-Modus nicht verfügbar ist; nutze für Standardprüfungen das verify-Tool.",
            }
          : {
              action: "ask",
              reason:
                "Freier Shell-Zugriff benötigt Bestätigung; nutze für Standardprüfungen das verify-Tool.",
            };
      }
    }
    return decideBash(
      permissionLevel,
      event.toolName === INTERACTIVE_SHELL_TOOL_NAME
        ? interactiveShellCommand(event)
        : String((event.input as Record<string, unknown>).command ?? ""),
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
      {
        allowOutsideProjectRead: options.allowOutsideProjectRead,
        additionalRoots: options.additionalRoots,
        systemFileRoots: options.systemFileRoots,
      },
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
  if (event.toolName === "workspace_add") {
    return { action: "allow", reason: "Nutzerbestätigte Workspace-Freigabe" };
  }
  if (event.toolName === "verify" || event.toolName === "project_check") {
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
    return decideFileAccess(permissionLevel, "write", filePath, cwd, {
      additionalRoots: options.additionalRoots,
      systemFileRoots: options.systemFileRoots,
    });
  }

  if (isYoloLevel(permissionLevel)) {
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
  // `wait` gehört zum Subagenten-Paket und blockiert nur, bis laufende Kind-Läufe
  // enden; es vergibt keine Fähigkeit. Ohne diesen Zweig fragte es als
  // "unbekanntes Tool" bei jedem Aufruf nach.
  if (event.toolName === "wait") {
    return {
      action: "allow",
      reason: "Warten auf Subagenten-Läufe ist ohne Bestätigung erlaubt",
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

export function decideTool(
  permissionLevel: PermissionLevel,
  event: ToolCallEvent,
  cwd: string,
  configured: {
    unknownTools: ConfiguredPolicyAction;
    bash: ConfiguredPolicyAction;
  },
  options: {
    allowOutsideProjectRead?: boolean;
    additionalRoots?: readonly string[];
    systemFileRoots?: readonly string[];
  } = {},
): PolicyDecision {
  const decision = decideToolBase(
    permissionLevel,
    event,
    cwd,
    configured,
    options,
  );
  if (
    decision.action !== "allow" ||
    (event.toolName !== "bash" &&
      event.toolName !== INTERACTIVE_SHELL_TOOL_NAME)
  )
    return decision;

  const command =
    event.toolName === INTERACTIVE_SHELL_TOOL_NAME
      ? interactiveShellCommand(event)
      : String((event.input as Record<string, unknown>).command ?? "");
  // YOLO is the person's explicit "no questions" mode in the project profile
  // (ADR 029); the System profile keeps asking for protected commands there.
  const yoloProjectBypass =
    getPiLaunchProfile() !== "system" &&
    (permissionLevel === "yolo" ||
      permissionLevel === "yolo-ask" ||
      permissionLevel === "yolo-full");
  if (!yoloProjectBypass && systemBashNeedsApproval(command)) {
    return {
      action: "ask",
      reason:
        "Geschütztes Systemkommando benötigt eine ausdrückliche Freigabe.",
    };
  }
  // The project profile has no open policy, but it must not run critical
  // system or git-loss operations unasked just because it was started in a
  // repository: the same heuristic the System profile uses asks first.
  if (
    getPiLaunchProfile() !== "system" &&
    (permissionLevel === "project-write" || permissionLevel === "headless")
  ) {
    const risk = systemOpenBashRisk(command);
    if (risk) return { action: "ask", reason: risk.reason };
  }
  return decision;
}
