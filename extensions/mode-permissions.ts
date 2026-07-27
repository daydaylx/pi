/**
 * Central permission decision layer, independent from the workflow mode.
 *
 * This is intentionally the only extension that intercepts tool_call and
 * user_bash. Workflow extensions do not make access decisions themselves.
 */

import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { relative, resolve, sep } from "node:path";
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
import { runTabbedOverlay } from "./shared/tabbed-overlay.ts";
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
  permissionRiskStatusValue,
  setTuiStatus,
  normalizePermissionLevel,
  type PermissionLevel,
  type PermissionState,
  type WorkflowMode,
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
  WORKFLOW_CAPABILITY_EVENTS,
  requestWorkflowCapabilities,
  type WorkflowActivatedEvent,
  type WorkflowCapabilitySnapshot,
} from "./shared/workflow-capabilities.ts";

const PERSISTED_STATE_KEY = "mode-permissions";

const LOCAL_LSP_TOOLS = new Set([
  "lsp_diagnostics",
  "lsp_definition",
  "lsp_references",
  "lsp_hover",
  "lsp_workspace_symbols",
]);
const READ_ONLY_SUBAGENT_PROFILES = new Set([
  "planner",
  "reviewer",
]);

function isRestrictedWorkflow(snapshot: WorkflowCapabilitySnapshot): boolean {
  return [
    "planning",
    "reviewing",
    "paused",
    "blocked",
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

function isManagedWorkflowArtifactPath(rawPath: string, cwd: string): boolean {
  const target = resolve(cwd, rawPath);
  const plansRoot = resolve(cwd, ".agent/plans");
  const plansRelative = relative(plansRoot, target);
  return (
    plansRelative === "" ||
    (plansRelative !== ".." &&
      !plansRelative.startsWith(`..${sep}`)) ||
    target === resolve(cwd, ".agent/direct-task.json")
  );
}

function referencesWorkflowArtifact(command: string): boolean {
  const normalized = command.replace(/\\/g, "/");
  return (
    normalized.includes(".agent/plans/") ||
    normalized.includes(".agent/direct-task.json")
  );
}

function decideWorkflowTool(
  workflow: WorkflowCapabilitySnapshot,
  event: ToolCallEvent,
  cwd: string,
): PolicyDecision | undefined {
  const managedPath = toolPath(event);
  if (
    managedPath &&
    isManagedWorkflowArtifactPath(managedPath, cwd) &&
    !["read", "grep", "find", "ls"].includes(event.toolName)
  ) {
    if (event.toolName === "write" || event.toolName === "edit") {
      if (
        workflowAllowsPlanWrite(workflow) &&
        isPlanFilePath(managedPath, cwd)
      ) {
        return {
          action: "allow",
          reason: "Workflow: kontrollierter Plan-Schreibzugriff",
        };
      }
    }
    return {
      action: "block",
      reason:
        "Workflow-Artefakte dürfen nur über Plan-Mode und plan_progress aktualisiert werden.",
    };
  }
  if (
    workflow.state === "working" &&
    (event.toolName === "write" || event.toolName === "edit")
  ) {
    return undefined;
  }
  if (
    event.toolName === "bash" &&
    referencesWorkflowArtifact(
      String((event.input as Record<string, unknown>).command ?? ""),
    )
  ) {
    return {
      action: "block",
      reason:
        "Workflow-Artefakte sind über Shell gesperrt; nutze Plan-Mode, Direct-Task-Kommandos oder plan_progress.",
    };
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
  if (level === "confirm-all") {
    return "CONFIRM ALL aktiv: Jede Mutation und externe Aktion benötigt eine Bestätigung.";
  }
  if (level === "yolo") {
    return "YOLO temporär aktiv: Rückfragen entfallen; harte Secret-, System-, Symlink- und Trust-Grenzen bleiben aktiv.";
  }
  return undefined;
}

function toolPath(event: ToolCallEvent): string | undefined {
  const input = event.input as Record<string, unknown>;
  return typeof input.path === "string"
    ? input.path
    : typeof input.filePath === "string"
      ? input.filePath
      : undefined;
}

// Planning/reviewing alone may grant a write exception for the current plan.
// Outside those workflow capabilities, readonly blocks the same path.
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
        ? { action: "ask", reason: "Verifikation kann Projektartefakte erzeugen." }
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

  if (
    permissionLevel === "readonly" &&
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
  let configuredPolicy = defaultSetupConfig().permissions;
  let activeWorkflowMode: WorkflowMode = "work";
  let workflowDefaultPermission: Exclude<PermissionLevel, "yolo"> =
    configuredPolicy.workflowDefaults.work;
  let selectedPermissionLevel: Exclude<PermissionLevel, "yolo"> =
    workflowDefaultPermission;
  let selectedPermissionState: Exclude<PermissionState, "YOLO_OVERRIDE"> =
    "DEFAULT";
  let permissionState: PermissionState = "DEFAULT";
  let permissionLevel: PermissionLevel = selectedPermissionLevel;
  let sessionEpoch = 0;
  let activeSessionId: string | undefined;
  let activeContext: ExtensionContext | undefined;
  let thinkingMode: "auto" | "manual" = "auto";
  let manualThinkingLevel: SelectableThinkingLevel | undefined;
  let auroraEpoch: string | undefined;
  let unsubscribeAurora: (() => void) | undefined;

  function publishStatus(ctx: ExtensionContext): void {
    setTuiStatus(
      ctx,
      ZENTUI_STATUS_KEYS.permissions,
      permissionRiskStatusValue(permissionLevel, permissionState),
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
      permissionLevel: selectedPermissionLevel,
      workflowDefaultPermission,
      selectedPermissionLevel,
      selectedPermissionState,
      permissionState: selectedPermissionState,
      workflowMode: activeWorkflowMode,
      thinkingMode,
      manualThinkingLevel,
    });
  }

  function auditTransition(
    source: "command" | "shortcut" | "workflow" | "session",
  ): void {
    // This is a persistent session audit entry. It intentionally records no
    // command text, paths, tool input, or other potentially sensitive data.
    pi.appendEntry("permission-transition", {
      timestamp: new Date().toISOString(),
      source,
      state: permissionState,
      selectedState: selectedPermissionState,
      effectiveLevel: permissionLevel,
      selectedLevel: selectedPermissionLevel,
      workflowDefaultLevel: workflowDefaultPermission,
      workflowMode: activeWorkflowMode,
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

  function applyWorkflowDefaults(
    workflowMode: WorkflowMode,
    ctx: ExtensionContext,
    source: "workflow" | "session",
  ): void {
    activeWorkflowMode = workflowMode;
    workflowDefaultPermission = configuredPolicy.workflowDefaults[workflowMode];
    if (selectedPermissionState === "DEFAULT") {
      selectedPermissionLevel = workflowDefaultPermission;
    }
    // YOLO is a temporary bypass, never a workflow preference.  A workflow
    // transition therefore exits it, while an explicitly selected normal
    // level remains intact.
    permissionState = selectedPermissionState;
    permissionLevel = selectedPermissionLevel;
    publishStatus(ctx);
    persistState();
    auditTransition(source);
    if (source === "workflow") {
      const detail = selectedPermissionState === "MANUAL"
        ? `manuelle Stufe ${PERMISSION_LEVEL_LABEL[selectedPermissionLevel]} bleibt aktiv`
        : `Default ${PERMISSION_LEVEL_LABEL[workflowDefaultPermission]} aktiv`;
      ctx.ui.notify(`🔄 Workflow ${workflowMode}: ${detail}.`, "info");
    }
  }

  async function toggleYolo(
    ctx: ExtensionContext,
    source: "command" | "shortcut",
    epoch = sessionEpoch,
  ): Promise<void> {
    if (epoch !== sessionEpoch) return;
    if (permissionState === "YOLO_OVERRIDE") {
      permissionState = selectedPermissionState;
      permissionLevel = selectedPermissionLevel;
    } else {
      permissionState = "YOLO_OVERRIDE";
      permissionLevel = "yolo";
    }
    publishStatus(ctx);
    if (permissionState !== "YOLO_OVERRIDE") persistState();
    auditTransition(source);
    const warning = permissionWarning(permissionLevel);
    ctx.ui.notify(
      warning ?? `Zugriffsstufe: ${PERMISSION_LEVEL_LABEL[permissionLevel]}.`,
      warning ? "warning" : "info",
    );
  }

  async function applyPermissionLevel(
    level: PermissionLevel,
    ctx: ExtensionContext,
    epoch = sessionEpoch,
  ): Promise<void> {
    if (epoch !== sessionEpoch) return;
    if (level === "yolo") {
      await toggleYolo(ctx, "command", epoch);
      return;
    }
    const nextState: Exclude<PermissionState, "YOLO_OVERRIDE"> =
      level === workflowDefaultPermission ? "DEFAULT" : "MANUAL";
    if (
      permissionState !== "YOLO_OVERRIDE" &&
      selectedPermissionState === nextState &&
      selectedPermissionLevel === level
    )
      return;

    selectedPermissionState = nextState;
    selectedPermissionLevel = level;
    permissionState = nextState;
    permissionLevel = level;
    publishStatus(ctx);
    persistState();
    auditTransition("command");
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
    const entries = buildThinkingMenu(pi.getThinkingLevel(), thinkingMode)
      .filter((entry) => {
        if (entry.value === "auto") return true;
        const value = entry.value;
        if (!value) return false;
        const level = value.slice("manual:".length) as SelectableThinkingLevel;
        return ctx.model?.thinkingLevelMap?.[level] !== null;
      });
    const selected = await runTabbedOverlay<
      "auto" | `manual:${SelectableThinkingLevel}` | "thinking-view"
    >(ctx, "Thinking & Reasoning", [
      {
        id: "depth",
        label: "Denktiefe",
        entries,
      },
      {
        id: "telemetry",
        label: "Anzeige & Telemetrie",
        entries: [
          {
            id: "thinking-view",
            label: "Status-Telemetrie",
            description: "Ausgeblendet, kompakt oder mit Fokus; zeigt nie interne Modellgedanken",
            value: "thinking-view",
          },
        ],
      },
    ], { nonInteractiveHint: "Thinking & Reasoning benötigt den TUI-Modus." });
    const value = selected?.entry.value;
    if (value === "thinking-view") {
      pi.events.emit(CONTROL_CENTER_EVENTS.openThinkingView, { ctx });
      return;
    }
    const selectedLevel = value;
    if (!selectedLevel || epoch !== sessionEpoch) return;

    if (selectedLevel === "auto") {
      thinkingMode = "auto";
      manualThinkingLevel = undefined;
      const level = workflowThinkingDefault();
      pi.setThinkingLevel(level);
      persistState();
      ctx.ui.notify(`Thinking: ${thinkingLabel(thinkingMode, level)}.`, "info");
      return;
    }

    const level = selectedLevel.slice("manual:".length) as SelectableThinkingLevel;
    thinkingMode = "manual";
    manualThinkingLevel = level;
    pi.setThinkingLevel(level);
    persistState();
    ctx.ui.notify(`Thinking: ${thinkingLabel(thinkingMode, level)}.`, "info");
  }

  pi.registerCommand("yolo", {
    description: "Session-weiten YOLO Mode ein-/ausschalten",
    handler: async (_args, ctx) => toggleYolo(ctx, "command"),
  });

  pi.registerCommand("full-access", {
    description: "Legacy-Alias für Confirm All",
    handler: async (_args, ctx) =>
      applyPermissionLevel(
        permissionState !== "YOLO_OVERRIDE" &&
          selectedPermissionState === "MANUAL" &&
          selectedPermissionLevel === "confirm-all"
          ? workflowDefaultPermission
          : "confirm-all",
        ctx,
      ),
  });

  pi.registerCommand("permission", {
    description:
      "Zugriffsstufe setzen: readonly | project-write | confirm-all | yolo",
    handler: async (args, ctx) => {
      const raw = args.trim();
      const level =
        Object.hasOwn(PERMISSION_LEVEL_LABEL, raw)
          ? (raw as PermissionLevel)
          : normalizePermissionLevel(raw);
      if (!level) {
        ctx.ui.notify(
          "Nutzung: /permission readonly|project-write|confirm-all|yolo",
          "info",
        );
        return;
      }
      await applyPermissionLevel(level, ctx);
    },
  });

  pi.registerShortcut(SHORTCUTS.thinkingMenu.keys, {
    description: SHORTCUTS.thinkingMenu.description,
    handler: async (ctx) => openThinkingMenu(ctx),
  });
  pi.registerShortcut(SHORTCUTS.yoloToggle.keys, {
    description: SHORTCUTS.yoloToggle.description,
    handler: async (ctx) => toggleYolo(ctx, "shortcut"),
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
  pi.events.on(WORKFLOW_CAPABILITY_EVENTS.activated, (event) => {
    const activated = event as WorkflowActivatedEvent;
    if (
      !activeContext ||
      activated.sessionId !== activeSessionId ||
      activated.cwd !== activeContext.cwd
    ) {
      return;
    }
    applyWorkflowDefaults(activated.mode, activeContext, "workflow");
  });

  pi.on("tool_call", async (event, ctx) => {
    if (
      !ctx.isProjectTrusted() &&
      !["read", "grep", "find", "ls", "ask_user"].includes(event.toolName)
    ) {
      return {
        block: true,
        reason:
          "Harte Trust-Grenze: mutierende oder externe Tools sind im nicht vertrauenswürdigen Projekt blockiert.",
      };
    }
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
    if (!ctx.isProjectTrusted()) {
      return {
        result: {
          output:
            "Harte Trust-Grenze: Shell-Zugriff ist im nicht vertrauenswürdigen Projekt blockiert.",
          exitCode: 126,
          cancelled: true,
          truncated: false,
        },
      };
    }
    const workflow = requestWorkflowCapabilities(pi.events);
    const decision = referencesWorkflowArtifact(event.command)
      ? {
          action: "block" as const,
          reason:
            "Workflow-Artefakte sind über Shell gesperrt; nutze Plan-Mode, Direct-Task-Kommandos oder plan_progress.",
        }
      : isRestrictedWorkflow(workflow)
      ? {
          action: "block" as const,
          reason: `Workflow ${workflow.state}: direkter Shell-Zugriff ist nicht freigegeben.`,
        }
      : permissionLevel === "project-write" && configuredPolicy.bash !== "allow"
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
    activeSessionId = ctx.sessionManager.getSessionId();
    activeContext = ctx;
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
            permissionLevel?: unknown;
            selectedPermissionLevel?: unknown;
            selectedPermissionState?: unknown;
            thinkingMode?: "auto" | "manual";
            manualThinkingLevel?: SelectableThinkingLevel;
          };
        }
      | undefined;
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
    const persistedRaw =
      latestState?.data?.selectedPermissionLevel ??
      latestState?.data?.permissionLevel;
    const normalizedPersistedLevel = normalizePermissionLevel(persistedRaw);
    const restoredLevel =
      normalizedPersistedLevel === "yolo"
        ? "project-write"
        : normalizedPersistedLevel;
    const persistedManual =
      latestState?.data?.selectedPermissionState === "MANUAL" ||
      persistedRaw === "yolo" ||
      (latestState?.data?.selectedPermissionState === undefined &&
        restoredLevel !== undefined);
    selectedPermissionLevel = restoredLevel ?? configuredPolicy.workflowDefaults.work;
    selectedPermissionState = persistedManual ? "MANUAL" : "DEFAULT";
    permissionState = "DEFAULT";
    applyWorkflowDefaults(
      requestWorkflowCapabilities(pi.events).mode ?? "work",
      ctx,
      "session",
    );
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    sessionEpoch += 1;
    unsubscribeAurora?.();
    unsubscribeAurora = undefined;
    auroraEpoch = undefined;
    activeSessionId = undefined;
    activeContext = undefined;
    setTuiStatus(ctx, ZENTUI_STATUS_KEYS.permissions, undefined);
  });
}
