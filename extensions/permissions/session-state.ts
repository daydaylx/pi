/**
 * Permission mode state: selection, YOLO and persistence.
 *
 * Two values, deliberately distinct:
 *   selectedPermissionLevel/State — what the user chose (persisted)
 *   permissionLevel/State         — what is actually in force right now
 *
 * The workflow mode does not live here: it is orthogonal to the permission
 * level and is queried live from plan-mode via requestWorkflowCapabilities
 * exactly where it matters for a decision (permissions/guards.ts). YOLO
 * exists in the effective pair alone. It is a temporary bypass, never a
 * preference: it is never persisted. It comes in three stufen (yolo,
 * yolo-ask, yolo-full; see workflow-status.ts). The trust boundary and the
 * Plan Mode write ban and Recovery workspace-integrity gate stay active on
 * all of them. YOLO 1 additionally keeps the hard secret/symlink boundaries;
 * the system-level shell boundaries and commit-verifier gate are the
 * deliberate bypass surface (see workflow-policy.ts, verifier-policy.ts,
 * guards.ts).
 *
 * The session epoch guards against a menu that resolves after the session it
 * belonged to has ended.
 */
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  FRONTEND_UI_CHANNELS,
  isFrontendUiStateRequest,
  publishFrontendUiPatch,
  publishFrontendUiSnapshot,
} from "../frontend-protocol/state-bus.ts";
import {
  PERMISSION_LEVEL_LABEL,
  UI_STATUS_KEYS,
  isYoloLevel,
  normalizePermissionLevel,
  permissionRiskStatusValue,
  setTuiStatus,
  type PermissionLevel,
  type PermissionState,
  type YoloLevel,
} from "../shared/workflow-status.ts";
import {
  defaultSetupConfig,
  loadSetupConfig,
  type PolicyAction as ConfiguredPolicyAction,
} from "../setup-core/config.ts";
import {
  isWorkflowStateUnknown,
  requestWorkflowCapabilities,
} from "../shared/workflow-capabilities.ts";
import { permissionWarning } from "./tool-policy.ts";
import type { ThinkingControl } from "./thinking-control.ts";

export const PERSISTED_STATE_KEY = "mode-permissions";

/** The single session record shared by permission and thinking state. */
interface PersistedPermissionState {
  permissionLevel?: unknown;
  selectedPermissionLevel?: unknown;
  selectedPermissionState?: unknown;
  // Records written before the auto thinking mode was retired can still carry
  // `"auto"` in either field, so both stay deliberately untyped here and are
  // validated on restore.
  thinkingMode?: unknown;
  manualThinkingLevel?: unknown;
}

export interface ConfiguredToolPolicy {
  unknownTools: ConfiguredPolicyAction;
  bash: ConfiguredPolicyAction;
}

export interface PermissionSession {
  readonly pi: ExtensionAPI;
  level(): PermissionLevel;
  configured(): ConfiguredToolPolicy;
  context(): ExtensionContext | undefined;
  isCurrentEpoch(epoch: number): boolean;
  epoch(): number;
  persist(): void;
  applyPermissionLevel(
    level: PermissionLevel,
    ctx: ExtensionContext,
    epoch?: number,
  ): Promise<void>;
  /**
   * Without `level`: toggles YOLO 1 (off when any YOLO stufe is active).
   * With `level`: switches to that stufe, or turns YOLO off when it is
   * already the active one.
   */
  toggleYolo(
    ctx: ExtensionContext,
    source: "command" | "shortcut",
    epoch?: number,
    level?: YoloLevel,
  ): Promise<void>;
  /** True when the event belongs to the session that is currently active. */
  ownsSession(sessionId: string, cwd: string): boolean;
  beginSession(ctx: ExtensionContext): void;
  endSession(ctx: ExtensionContext): void;
}

export function createPermissionSession(
  pi: ExtensionAPI,
  thinking: ThinkingControl,
): PermissionSession {
  let configuredPolicy = defaultSetupConfig().permissions;
  let selectedPermissionLevel: PermissionLevel = "project-write";
  let selectedPermissionState: Exclude<PermissionState, "YOLO_OVERRIDE"> =
    "DEFAULT";
  let permissionState: PermissionState = "DEFAULT";
  let permissionLevel: PermissionLevel = selectedPermissionLevel;
  let sessionEpoch = 0;
  let activeSessionId: string | undefined;
  let activeContext: ExtensionContext | undefined;
  let auroraEpoch: string | undefined;
  let unsubscribeAurora: (() => void) | undefined;

  function publishStatus(ctx: ExtensionContext): void {
    setTuiStatus(
      ctx,
      UI_STATUS_KEYS.permissions,
      permissionRiskStatusValue(permissionLevel, permissionState),
    );
    if (auroraEpoch) {
      publishFrontendUiPatch(pi, auroraEpoch, "permissions", {
        permissions: {
          level: permissionLevel,
          label: PERMISSION_LEVEL_LABEL[permissionLevel],
        },
      });
    }
  }

  function subscribeAuroraProvider(): void {
    unsubscribeAurora?.();
    unsubscribeAurora = pi.events.on(FRONTEND_UI_CHANNELS.request, (value) => {
      if (!isFrontendUiStateRequest(value)) return;
      auroraEpoch = value.sessionEpoch;
      publishFrontendUiSnapshot(pi, value, "permissions", {
        permissions: {
          level: permissionLevel,
          label: PERMISSION_LEVEL_LABEL[permissionLevel],
        },
      });
    });
  }

  function auditTransition(source: "command" | "shortcut" | "session"): void {
    pi.appendEntry("permission-transition", {
      timestamp: new Date().toISOString(),
      source,
      state: permissionState,
      selectedState: selectedPermissionState,
      effectiveLevel: permissionLevel,
      selectedLevel: selectedPermissionLevel,
    });
  }

  /**
   * A workflow provider that never answers at all (no plan-mode extension
   * loaded, or a bridge failure) is a different risk than an active Plan
   * Mode: it means nobody can vouch for what mode is actually in force. YOLO
   * stays blocked for that case — fail-closed robustness net, not a planning
   * restriction — even though YOLO is otherwise allowed during Plan Mode.
   */
  function yoloDeniedOnUnknownWorkflowState(
    ctx: ExtensionContext,
    source: "command" | "shortcut" | "session",
  ): boolean {
    const workflow = requestWorkflowCapabilities(pi.events);
    if (!isWorkflowStateUnknown(workflow)) return false;
    pi.appendEntry("permission-transition-denied", {
      timestamp: new Date().toISOString(),
      source,
      attemptedLevel: "yolo",
      mode: "unknown",
      reason: "YOLO ist gesperrt, solange kein Workflow-Zustand gemeldet wird.",
    });
    ctx.ui.notify(
      "YOLO ist gesperrt: Keine Workflow-Extension meldet den aktuellen Modus.",
      "warning",
    );
    return true;
  }

  const session: PermissionSession = {
    pi,
    level: () => permissionLevel,
    configured: () => configuredPolicy,
    context: () => activeContext,
    epoch: () => sessionEpoch,
    isCurrentEpoch: (epoch) => epoch === sessionEpoch,

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
        selectedPermissionLevel,
        selectedPermissionState,
        permissionState: selectedPermissionState,
        ...thinking.fields(),
      });
    },

    async toggleYolo(ctx, source, epoch = sessionEpoch, level) {
      if (epoch !== sessionEpoch) return;
      // YOLO ist jetzt auch im Plan Mode aktivierbar (bewusste Lockerung,
      // analog zu Claude Codes bypassPermissions-Modus). Das hebt
      // planModeMutationGuard nicht auf: Der Plan Mode bleibt unabhängig vom
      // Zugriffslevel eine harte Schreibgrenze (workflow-policy.ts). Ein
      // komplett unbekannter Workflow-Zustand bleibt weiterhin gesperrt.
      const active = permissionState === "YOLO_OVERRIDE";
      const turnOff =
        active && (level === undefined || level === permissionLevel);
      if (!turnOff && yoloDeniedOnUnknownWorkflowState(ctx, source)) return;
      if (turnOff) {
        permissionState = selectedPermissionState;
        permissionLevel = selectedPermissionLevel;
      } else {
        permissionState = "YOLO_OVERRIDE";
        permissionLevel = level ?? "yolo";
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
      if (isYoloLevel(level)) {
        await session.toggleYolo(ctx, "command", epoch, level);
        return;
      }
      const nextState: Exclude<PermissionState, "YOLO_OVERRIDE"> =
        level === "project-write" || level === "headless"
          ? "DEFAULT"
          : "MANUAL";
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

    beginSession(ctx) {
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

      const persistedRaw =
        latestState?.data?.selectedPermissionLevel ??
        latestState?.data?.permissionLevel;
      const normalizedPersistedLevel = normalizePermissionLevel(persistedRaw);
      const restoredLevel = isYoloLevel(normalizedPersistedLevel)
        ? "project-write"
        : normalizedPersistedLevel;
      // Phase 2.3: a fresh session (no prior persisted choice in this
      // project) outside the TUI has no confirm dialog available at all.
      // Defaulting it to "project-write" - as every session got before -
      // meant any command needing a dialog silently failed or hung with no
      // clear signal why. A TUI session keeps today's default unchanged; any
      // project with a prior persisted choice (in any mode) keeps respecting
      // that choice, regardless of mode.
      const freshDefaultLevel: PermissionLevel =
        ctx.mode === "tui" ? "project-write" : "headless";
      selectedPermissionLevel = restoredLevel ?? freshDefaultLevel;
      selectedPermissionState =
        selectedPermissionLevel === "project-write" ||
        selectedPermissionLevel === "headless"
          ? "DEFAULT"
          : "MANUAL";
      permissionState = selectedPermissionState;
      permissionLevel = selectedPermissionLevel;
      publishStatus(ctx);
      session.persist();
      auditTransition("session");
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
