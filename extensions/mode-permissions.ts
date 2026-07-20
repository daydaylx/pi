/**
 * Central permission decision layer, independent from the workflow mode.
 *
 * This is intentionally the only extension that intercepts tool_call and
 * user_bash. Workflow extensions do not make access decisions themselves.
 */

import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type {
  ExtensionAPI,
  ExtensionContext,
  ToolCallEvent,
} from "@earendil-works/pi-coding-agent";
import {
  decideBash,
  decideFileAccess,
  type PolicyDecision,
  type ProtectedWritePath,
} from "./shared/permission-policy.ts";
import { isPlanFilePath, PLAN_RELATIVE_PATH } from "./plan-mode/utils.ts";
import { confirmAction } from "./shared/permission-dialog.ts";
import { runMenu } from "./shared/menu-ui.ts";
import { buildPermissionMenu } from "./shared/permission-menu.ts";
import {
  buildThinkingMenu,
  thinkingLabel,
  type SelectableThinkingLevel,
} from "./shared/thinking-menu.ts";
import { SHORTCUTS } from "./shared/shortcuts.ts";
import {
  CONTROL_CENTER_EVENTS,
  type ControlCenterSnapshot,
  type ControlCenterSnapshotEvent,
  type OpenControlCenterMenuEvent,
} from "./shared/control-center-events.ts";
import {
  PERMISSION_LEVEL_LABEL,
  ZENTUI_STATUS_KEYS,
  normalizePermissionLevel,
  permissionRiskStatusValue,
  setTuiStatus,
  type PermissionLevel,
} from "./shared/workflow-status.ts";
import {
  defaultSetupConfig,
  loadSetupConfig,
  type PolicyAction as ConfiguredPolicyAction,
} from "./setup-core/config.ts";
import {
  AURORA_UI_CHANNELS,
  isAuroraUiStateRequest,
  publishAuroraUiPatch,
  publishAuroraUiSnapshot,
} from "./aurora-ui/state.ts";
import {
  requestWorkflowCapabilities,
  type WorkflowCapabilitySnapshot,
} from "./shared/workflow-capabilities.ts";

const PERSISTED_STATE_KEY = "mode-permissions";

// Permission-Stufen sind vom Workflow-Modus unabhängig. YOLO wird nie beim
// Session-Start aktiviert, sondern nur durch eine explizite Nutzeraktion.
const AUTO_YOLO_ON_START = false;
const LOCAL_LSP_TOOLS = new Set([
  "lsp_diagnostics",
  "lsp_definition",
  "lsp_references",
  "lsp_hover",
  "lsp_workspace_symbols",
]);
const READ_ONLY_SUBAGENT_PROFILES = new Set([
  "scout",
  "planner",
  "architect",
  "reviewer",
  "test-runner",
  "security-auditor",
  "ui-reviewer",
  "docs-auditor",
  "oracle",
]);

function isRestrictedWorkflow(snapshot: WorkflowCapabilitySnapshot): boolean {
  return [
    "planning",
    "reviewing",
    "deciding",
    "paused",
    "blocked",
    "ready",
  ].includes(snapshot.state);
}

function workflowAllowsPlanWrite(
  snapshot: WorkflowCapabilitySnapshot,
): boolean {
  return snapshot.state === "planning" || snapshot.state === "reviewing";
}

function subagentProfiles(input: unknown): string[] | undefined {
  if (!input || typeof input !== "object") return undefined;
  const value = input as Record<string, unknown>;
  if (
    value.action === "list" &&
    Object.keys(value).every((key) => key === "action")
  ) {
    return [];
  }
  if (typeof value.agent === "string" && typeof value.task === "string") {
    return [value.agent];
  }
  if (Array.isArray(value.tasks) && value.tasks.length > 0) {
    const profiles = value.tasks.map((task) =>
      task && typeof task === "object"
        ? (task as Record<string, unknown>).agent
        : undefined,
    );
    return profiles.every(
      (profile): profile is string => typeof profile === "string",
    )
      ? profiles
      : undefined;
  }
  if (Array.isArray(value.chain) && value.chain.length > 0) {
    const profiles = value.chain.map((task) =>
      task && typeof task === "object"
        ? (task as Record<string, unknown>).agent
        : undefined,
    );
    return profiles.every(
      (profile): profile is string => typeof profile === "string",
    )
      ? profiles
      : undefined;
  }
  return undefined;
}

function decideWorkflowTool(
  workflow: WorkflowCapabilitySnapshot,
  event: ToolCallEvent,
  cwd: string,
): PolicyDecision | undefined {
  if (
    workflow.state === "executing" &&
    (event.toolName === "write" || event.toolName === "edit")
  ) {
    const filePath = toolPath(event) ?? "";
    if (isPlanFilePath(filePath, cwd)) {
      return {
        action: "block",
        reason:
          "Während der Ausführung darf der Plan nur über plan_progress aktualisiert werden.",
      };
    }
    return undefined;
  }
  if (!isRestrictedWorkflow(workflow)) return undefined;

  if (["read", "grep", "find", "ls"].includes(event.toolName)) return undefined;
  if (LOCAL_LSP_TOOLS.has(event.toolName)) {
    return { action: "allow", reason: "Workflow: read-only LSP capability" };
  }
  if (event.toolName === "ask_user" || event.toolName === "wait") {
    return { action: "allow", reason: "Workflow: kontrollierte Fähigkeit" };
  }
  if (event.toolName === "verify") return undefined;
  if (event.toolName === "subagent") {
    const profiles = subagentProfiles(event.input);
    return profiles &&
      profiles.every((profile) => READ_ONLY_SUBAGENT_PROFILES.has(profile))
      ? { action: "allow", reason: "Workflow: read-only Subagenten" }
      : {
          action: "block",
          reason:
            "Dieser Workflow erlaubt nur bekannte read-only Subagentenprofile.",
        };
  }
  if (event.toolName === "write" || event.toolName === "edit") {
    const filePath = toolPath(event) ?? "";
    return workflowAllowsPlanWrite(workflow) && isPlanFilePath(filePath, cwd)
      ? {
          action: "allow",
          reason: "Workflow: kontrollierter Plan-Schreibzugriff",
        }
      : {
          action: "block",
          reason:
            "Dieser Workflow blockiert Schreibzugriffe außerhalb des aktuellen Plans.",
        };
  }
  return {
    action: "block",
    reason: `Workflow ${workflow.state}: Tool "${event.toolName}" ist nicht freigegeben.`,
  };
}

function permissionWarning(level: PermissionLevel): string | undefined {
  if (level === "full-access") {
    return "VOLLZUGRIFF aktiv: Sudo, Löschen, externe Schreibzugriffe und Force-Push bleiben bestätigt.";
  }
  if (level === "yolo") {
    return "YOLO aktiv: harte Warnmuster für Secrets, Systempfade und kritische Aktionen bleiben bestätigt.";
  }
  return undefined;
}

function toolPath(event: ToolCallEvent): string | undefined {
  const input = event.input as Record<string, unknown>;
  return typeof input.path === "string" ? input.path : undefined;
}

// Restrictive permission levels still allow writes to the workflow
// extension's plan file. This is the only place mode-permissions.ts knows
// about plan-mode/utils.ts — shared/permission-policy.ts itself stays
// workflow-mode-independent and receives this as a plain callback.
const PROTECTED_WRITE_PATH: ProtectedWritePath = {
  matches: isPlanFilePath,
  label: PLAN_RELATIVE_PATH,
};

function decideTool(
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
  if (workflowDecision) return workflowDecision;

  if (event.toolName === "bash") {
    if (permissionLevel === "read-write") {
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
  if (event.toolName === "ask_user" || event.toolName === "plan_progress") {
    return { action: "allow", reason: "Controlled workflow capability" };
  }
  if (event.toolName === "verify") {
    return permissionLevel === "read-only"
      ? {
          action: "block",
          reason: "Read only: Verifikation benötigt mindestens Read + Bash.",
        }
      : { action: "allow", reason: "Allowlisted verification capability" };
  }

  if (event.toolName === "write" || event.toolName === "edit") {
    const filePath = toolPath(event) ?? "";
    return decideFileAccess(permissionLevel, "write", filePath, cwd, {
      protectedWritePath: PROTECTED_WRITE_PATH,
    });
  }

  if (
    (permissionLevel === "read-only" || permissionLevel === "read-bash") &&
    event.toolName !== "ask_user"
  ) {
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

async function approve(
  decision: PolicyDecision,
  subject: string,
  ctx: ExtensionContext,
  toolName?: string,
): Promise<boolean> {
  if (decision.action === "allow") return true;
  if (decision.action === "block") return false;
  if (!ctx.hasUI || ctx.mode !== "tui") return false;
  return confirmAction(ctx, decision, subject, toolName);
}

export default function modePermissionsExtension(pi: ExtensionAPI): void {
  let permissionLevel: PermissionLevel = AUTO_YOLO_ON_START
    ? "yolo"
    : "read-write";
  let sessionEpoch = 0;
  let configuredPolicy = defaultSetupConfig().permissions;
  let thinkingMode: "auto" | "manual" = "auto";
  let manualThinkingLevel: SelectableThinkingLevel | undefined;
  let auroraEpoch: string | undefined;
  let unsubscribeAurora: (() => void) | undefined;

  function publishStatus(ctx: ExtensionContext): void {
    setTuiStatus(
      ctx,
      ZENTUI_STATUS_KEYS.permissions,
      permissionRiskStatusValue(permissionLevel),
    );
    if (auroraEpoch) {
      publishAuroraUiPatch(pi, auroraEpoch, "permissions", {
        permissions: {
          level: permissionLevel,
          label: PERMISSION_LEVEL_LABEL[permissionLevel],
        },
      });
    }
  }

  function subscribeAuroraProvider(): void {
    unsubscribeAurora?.();
    unsubscribeAurora = pi.events.on(AURORA_UI_CHANNELS.request, (value) => {
      if (!isAuroraUiStateRequest(value)) return;
      auroraEpoch = value.sessionEpoch;
      publishAuroraUiSnapshot(pi, value, "permissions", {
        permissions: {
          level: permissionLevel,
          label: PERMISSION_LEVEL_LABEL[permissionLevel],
        },
      });
    });
  }

  function persistState(): void {
    pi.appendEntry(PERSISTED_STATE_KEY, {
      permissionLevel,
      thinkingMode,
      manualThinkingLevel,
    });
  }

  function workflowThinkingDefault(): ThinkingLevel {
    let level: ThinkingLevel | undefined;
    pi.events.emit(CONTROL_CENTER_EVENTS.workflowThinkingDefault, {
      respond: (value: { mode: string; defaultLevel: ThinkingLevel }) => {
        level = value.defaultLevel;
      },
    });
    return level ?? pi.getThinkingLevel();
  }

  function snapshot(): ControlCenterSnapshot {
    return {
      permissionLevel,
      permissionLabel: PERMISSION_LEVEL_LABEL[permissionLevel],
      thinkingMode,
      thinkingLevel: pi.getThinkingLevel(),
    };
  }

  async function applyPermissionLevel(
    level: PermissionLevel,
    ctx: ExtensionContext,
    epoch = sessionEpoch,
  ): Promise<void> {
    if (epoch !== sessionEpoch) return;
    if (level === permissionLevel) return;

    permissionLevel = level;
    publishStatus(ctx);
    persistState();
    const warning = permissionWarning(level);
    ctx.ui.notify(
      warning ?? `Zugriffsstufe: ${PERMISSION_LEVEL_LABEL[level]}.`,
      warning ? "warning" : "info",
    );
  }

  async function openPermissionMenu(ctx: ExtensionContext): Promise<void> {
    const epoch = sessionEpoch;
    const level = await runMenu(
      ctx,
      "Berechtigungen",
      buildPermissionMenu(permissionLevel),
      {
        fallbackPrompt: "Berechtigung wählen",
        nonInteractiveHint:
          "Das Berechtigungsmenü benötigt den TUI-Modus. Nutze /permission <level>.",
      },
    );
    if (!level || epoch !== sessionEpoch) return;
    await applyPermissionLevel(level, ctx, epoch);
  }

  async function openThinkingMenu(ctx: ExtensionContext): Promise<void> {
    const epoch = sessionEpoch;
    const selected = await runMenu(
      ctx,
      "Denken",
      buildThinkingMenu(pi.getThinkingLevel(), thinkingMode),
      { fallbackPrompt: "Denkmodus wählen" },
    );
    if (!selected || epoch !== sessionEpoch) return;

    if (selected === "auto") {
      thinkingMode = "auto";
      manualThinkingLevel = undefined;
      const level = workflowThinkingDefault();
      pi.setThinkingLevel(level);
      persistState();
      ctx.ui.notify(`Thinking: ${thinkingLabel(thinkingMode, level)}.`, "info");
      return;
    }

    const level = selected.slice("manual:".length) as SelectableThinkingLevel;
    thinkingMode = "manual";
    manualThinkingLevel = level;
    pi.setThinkingLevel(level);
    persistState();
    ctx.ui.notify(`Thinking: ${thinkingLabel(thinkingMode, level)}.`, "info");
  }

  pi.registerCommand("yolo", {
    description: "Session-weiten YOLO Mode ein-/ausschalten",
    handler: async (_args, ctx) =>
      applyPermissionLevel(
        permissionLevel === "yolo" ? "read-write" : "yolo",
        ctx,
      ),
  });

  pi.registerCommand("full-access", {
    description: "Session-weiten Full Access Mode ein-/ausschalten",
    handler: async (_args, ctx) =>
      applyPermissionLevel(
        permissionLevel === "full-access" ? "read-write" : "full-access",
        ctx,
      ),
  });

  pi.registerCommand("permission", {
    description:
      "Zugriffsstufe setzen: read-only | read-bash | read-write | full-access | yolo",
    handler: async (args, ctx) => {
      const level = args.trim() as PermissionLevel;
      if (!Object.hasOwn(PERMISSION_LEVEL_LABEL, level)) {
        ctx.ui.notify(
          "Nutzung: /permission read-only|read-bash|read-write|full-access|yolo",
          "info",
        );
        return;
      }
      await applyPermissionLevel(level, ctx);
    },
  });

  pi.registerShortcut(SHORTCUTS.permissionMenu.keys, {
    description: SHORTCUTS.permissionMenu.description,
    handler: async (ctx) => openPermissionMenu(ctx),
  });

  pi.registerShortcut(SHORTCUTS.thinkingMenu.keys, {
    description: SHORTCUTS.thinkingMenu.description,
    handler: async (ctx) => openThinkingMenu(ctx),
  });

  pi.events.on(CONTROL_CENTER_EVENTS.openPermissions, async (event) => {
    await openPermissionMenu((event as OpenControlCenterMenuEvent).ctx);
  });
  pi.events.on(CONTROL_CENTER_EVENTS.openThinking, async (event) => {
    await openThinkingMenu((event as OpenControlCenterMenuEvent).ctx);
  });
  pi.events.on(CONTROL_CENTER_EVENTS.snapshot, (event) => {
    (event as ControlCenterSnapshotEvent).respond(snapshot());
  });

  pi.on("tool_call", async (event, ctx) => {
    const decision = decideTool(
      permissionLevel,
      event,
      ctx.cwd,
      requestWorkflowCapabilities(pi.events),
      configuredPolicy,
    );
    const subject =
      event.toolName === "bash"
        ? String((event.input as Record<string, unknown>).command ?? "")
        : `${event.toolName}: ${toolPath(event) ?? ""}`;
    if (await approve(decision, subject, ctx, event.toolName)) return;

    return {
      block: true,
      reason:
        decision.action === "ask"
          ? `${decision.reason}: Bestätigung fehlt oder wurde abgelehnt.`
          : decision.reason,
    };
  });

  pi.on("user_bash", async (event, ctx) => {
    const workflow = requestWorkflowCapabilities(pi.events);
    const decision = isRestrictedWorkflow(workflow)
      ? {
          action: "block" as const,
          reason: `Workflow ${workflow.state}: direkter Shell-Zugriff ist nicht freigegeben.`,
        }
      : permissionLevel === "read-write" && configuredPolicy.bash !== "allow"
        ? configuredPolicy.bash === "block"
          ? {
              action: "block" as const,
              reason: "Bash ist in der Setup-Policy gesperrt.",
            }
          : {
              action: "ask" as const,
              reason: "Freier Shell-Zugriff benötigt Bestätigung.",
            }
        : decideBash(permissionLevel, event.command, event.cwd);
    if (await approve(decision, event.command, ctx, "bash")) return;
    return {
      result: {
        output:
          decision.action === "ask"
            ? `${decision.reason}: Bestätigung fehlt oder wurde abgelehnt.`
            : decision.reason,
        exitCode: 126,
        cancelled: true,
        truncated: false,
      },
    };
  });

  pi.on("session_start", async (_event, ctx) => {
    sessionEpoch += 1;
    auroraEpoch = undefined;
    subscribeAuroraProvider();
    configuredPolicy = loadSetupConfig(ctx.cwd, ctx.isProjectTrusted()).config
      .permissions;
    const latestState = ctx.sessionManager
      .getEntries()
      .filter(
        (entry: { type: string; customType?: string }) =>
          entry.type === "custom" && entry.customType === PERSISTED_STATE_KEY,
      )
      .pop() as
      | {
          data?: {
            permissionLevel?: PermissionLevel;
            thinkingMode?: "auto" | "manual";
            manualThinkingLevel?: SelectableThinkingLevel;
          };
        }
      | undefined;
    const restoredLevel = normalizePermissionLevel(
      latestState?.data?.permissionLevel,
    );
    permissionLevel =
      restoredLevel === "yolo"
        ? "read-write"
        : (restoredLevel ?? (AUTO_YOLO_ON_START ? "yolo" : "read-write"));
    thinkingMode =
      latestState?.data?.thinkingMode === "manual" ? "manual" : "auto";
    manualThinkingLevel = latestState?.data?.manualThinkingLevel;
    if (thinkingMode === "manual" && manualThinkingLevel) {
      pi.setThinkingLevel(manualThinkingLevel);
    } else {
      thinkingMode = "auto";
      manualThinkingLevel = undefined;
      pi.setThinkingLevel(workflowThinkingDefault());
    }
    publishStatus(ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    sessionEpoch += 1;
    unsubscribeAurora?.();
    unsubscribeAurora = undefined;
    auroraEpoch = undefined;
    setTuiStatus(ctx, ZENTUI_STATUS_KEYS.permissions, undefined);
  });
}
