/**
 * Permission mode state: selection, workflow defaults, YOLO and persistence.
 *
 * Three values, deliberately distinct:
 *   selectedPermissionLevel/State — what the user chose (persisted)
 *   workflowDefaultPermission     — what the active workflow asks for
 *   permissionLevel/State         — what is actually in force right now
 *
 * YOLO only ever exists in the effective pair. It is a temporary bypass, never
 * a preference: it is never persisted, a workflow transition exits it, and the
 * hard secret/system/symlink/trust boundaries stay active throughout.
 *
 * The session epoch guards against a menu that resolves after the session it
 * belonged to has ended.
 */
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  AURORA_UI_CHANNELS,
  isAuroraUiStateRequest,
  publishAuroraUiPatch,
  publishAuroraUiSnapshot,
} from "../aurora-ui/state.ts";
import {
  PERMISSION_LEVEL_LABEL,
  UI_STATUS_KEYS,
  normalizePermissionLevel,
  permissionRiskStatusValue,
  setTuiStatus,
  type PermissionLevel,
  type PermissionState,
  type WorkflowMode,
} from "../shared/workflow-status.ts";
import {
  defaultSetupConfig,
  loadSetupConfig,
  type PolicyAction as ConfiguredPolicyAction,
} from "../setup-core/config.ts";
import { permissionWarning } from "./tool-policy.ts";
import type { SelectableThinkingLevel } from "../shared/thinking-menu.ts";
import type { ThinkingControl } from "./thinking-control.ts";
import {
  PermissionGrantStore,
  type GrantChoice,
  type GrantDescriptor,
  type PermissionGrant,
} from "./grants.ts";

export type { PermissionGrant } from "./grants.ts";

export const PERSISTED_STATE_KEY = "mode-permissions";

/** The single session record shared by permission and thinking state. */
interface PersistedPermissionState {
  permissionLevel?: unknown;
  selectedPermissionLevel?: unknown;
  selectedPermissionState?: unknown;
  thinkingMode?: "auto" | "manual";
  manualThinkingLevel?: SelectableThinkingLevel;
}

export interface ConfiguredToolPolicy {
  unknownTools: ConfiguredPolicyAction;
  bash: ConfiguredPolicyAction;
}

export interface PermissionSession {
  level(): PermissionLevel;
  configured(): ConfiguredToolPolicy;
  context(): ExtensionContext | undefined;
  isCurrentEpoch(epoch: number): boolean;
  epoch(): number;
  persist(): void;
  applyWorkflowDefaults(
    workflowMode: WorkflowMode,
    ctx: ExtensionContext,
    source: "workflow" | "session",
  ): void;
  applyPermissionLevel(
    level: PermissionLevel,
    ctx: ExtensionContext,
    epoch?: number,
  ): Promise<void>;
  toggleYolo(
    ctx: ExtensionContext,
    source: "command" | "shortcut",
    epoch?: number,
  ): Promise<void>;
  /** True when the event belongs to the session that is currently active. */
  ownsSession(sessionId: string, cwd: string): boolean;
  workflowDefaultLevel(): Exclude<PermissionLevel, "yolo">;
  beginSession(ctx: ExtensionContext, workflowMode: WorkflowMode): void;
  endSession(ctx: ExtensionContext): void;
  hasGrant(descriptor: GrantDescriptor, cwd: string): boolean;
  saveGrant(
    choice: Exclude<GrantChoice, "once" | "deny">,
    descriptor: GrantDescriptor,
    cwd: string,
  ): boolean;
  listGrants(scope: "project" | "global", cwd: string): PermissionGrant[];
  removeGrant(id: string): boolean;
  clearProjectGrants(cwd: string): void;
}

export function createPermissionSession(
  pi: ExtensionAPI,
  thinking: ThinkingControl,
): PermissionSession {
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
  let auroraEpoch: string | undefined;
  let unsubscribeAurora: (() => void) | undefined;
  const grants = new PermissionGrantStore();

  function publishStatus(ctx: ExtensionContext): void {
    setTuiStatus(
      ctx,
      UI_STATUS_KEYS.permissions,
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

  const session: PermissionSession = {
    level: () => permissionLevel,
    configured: () => configuredPolicy,
    context: () => activeContext,
    epoch: () => sessionEpoch,
    isCurrentEpoch: (epoch) => epoch === sessionEpoch,
    workflowDefaultLevel: () => workflowDefaultPermission,
    hasGrant: (descriptor, cwd) => grants.matches(descriptor, cwd),
    saveGrant: (choice, descriptor, cwd) => grants.add(choice, descriptor, cwd),
    listGrants: (scope, cwd) => grants.list(scope, cwd),
    removeGrant: (id) => grants.remove(id),
    clearProjectGrants: (cwd) => grants.clearProject(cwd),

    ownsSession(sessionId, cwd) {
      return Boolean(
        activeContext &&
        sessionId === activeSessionId &&
        cwd === activeContext.cwd,
      );
    },

    persist() {
      pi.appendEntry(PERSISTED_STATE_KEY, {
        permissionLevel: selectedPermissionLevel,
        workflowDefaultPermission,
        selectedPermissionLevel,
        selectedPermissionState,
        permissionState: selectedPermissionState,
        workflowMode: activeWorkflowMode,
        ...thinking.fields(),
      });
    },

    applyWorkflowDefaults(workflowMode, ctx, source) {
      activeWorkflowMode = workflowMode;
      workflowDefaultPermission =
        configuredPolicy.workflowDefaults[workflowMode];
      if (selectedPermissionState === "DEFAULT") {
        selectedPermissionLevel = workflowDefaultPermission;
      }
      // YOLO is a temporary bypass, never a workflow preference.  A workflow
      // transition therefore exits it, while an explicitly selected normal
      // level remains intact.
      permissionState = selectedPermissionState;
      permissionLevel = selectedPermissionLevel;
      // Auto thinking has to follow the workflow, not just the session start:
      // switching to an architecture plan must raise the depth immediately. A
      // manually chosen level is a user decision and stays untouched.
      thinking.followWorkflow();
      publishStatus(ctx);
      session.persist();
      auditTransition(source);
      if (source === "workflow") {
        const detail =
          selectedPermissionState === "MANUAL"
            ? `manuelle Stufe ${PERMISSION_LEVEL_LABEL[selectedPermissionLevel]} bleibt aktiv`
            : `Default ${PERMISSION_LEVEL_LABEL[workflowDefaultPermission]} aktiv`;
        ctx.ui.notify(`🔄 Workflow ${workflowMode}: ${detail}.`, "info");
      }
    },

    async toggleYolo(ctx, source, epoch = sessionEpoch) {
      if (epoch !== sessionEpoch) return;
      if (permissionState === "YOLO_OVERRIDE") {
        permissionState = selectedPermissionState;
        permissionLevel = selectedPermissionLevel;
      } else {
        permissionState = "YOLO_OVERRIDE";
        permissionLevel = "yolo";
      }
      publishStatus(ctx);
      if (permissionState !== "YOLO_OVERRIDE") session.persist();
      auditTransition(source);
      const warning = permissionWarning(permissionLevel);
      ctx.ui.notify(
        warning ?? `Zugriffsstufe: ${PERMISSION_LEVEL_LABEL[permissionLevel]}.`,
        warning ? "warning" : "info",
      );
    },

    async applyPermissionLevel(level, ctx, epoch = sessionEpoch) {
      if (epoch !== sessionEpoch) return;
      if (level === "yolo") {
        await session.toggleYolo(ctx, "command", epoch);
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
      session.persist();
      auditTransition("command");
      const warning = permissionWarning(level);
      ctx.ui.notify(
        warning ?? `Zugriffsstufe: ${PERMISSION_LEVEL_LABEL[level]}.`,
        warning ? "warning" : "info",
      );
    },

    beginSession(ctx, workflowMode) {
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
        .pop() as { data?: PersistedPermissionState } | undefined;
      thinking.restore(latestState?.data);
      // A persisted `yolo` is downgraded rather than restored: the bypass must
      // never survive a session boundary.
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
      selectedPermissionLevel =
        restoredLevel ?? configuredPolicy.workflowDefaults.work;
      selectedPermissionState = persistedManual ? "MANUAL" : "DEFAULT";
      permissionState = "DEFAULT";
      session.applyWorkflowDefaults(workflowMode, ctx, "session");
    },

    endSession(ctx) {
      sessionEpoch += 1;
      unsubscribeAurora?.();
      unsubscribeAurora = undefined;
      auroraEpoch = undefined;
      activeSessionId = undefined;
      activeContext = undefined;
      setTuiStatus(ctx, UI_STATUS_KEYS.permissions, undefined);
    },
  };
  return session;
}
