/**
 * Permission mode state: selection, YOLO and persistence.
 *
 * Two values, deliberately distinct:
 *   selectedPermissionLevel/State — what the user chose (persisted)
 *   permissionLevel/State         — what is actually in force right now
 *
 * YOLO exists in the effective pair alone. It is a temporary bypass, never a
 * preference: it is never persisted. It comes in three stufen (yolo,
 * yolo-ask, yolo-full; see workflow-status.ts). The trust boundary and the
 * Recovery workspace-integrity gate stay active on YOLO 1 and 2; YOLO 3
 * explicitly bypasses the Recovery gate. YOLO 1
 * additionally keeps the hard secret/symlink boundaries;
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
import { resolve } from "node:path";
import { isInside } from "../shared/path-utils.ts";
import {
  WORKSPACE_SCOPE_EVENTS,
  canonicalWorkspaceRoot,
  gitWorkspaceRootForPath,
  type WorkspaceScopeRequest,
} from "../shared/workspace-scope.ts";
import {
  getPiLaunchProfile,
  hasFrontendConfirmChannel,
  resolveSystemWorkspaceRoot,
} from "../shared/profile.ts";
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
import { permissionWarning } from "./tool-policy.ts";
import type { ThinkingControl } from "./thinking-control.ts";

export const PERSISTED_STATE_KEY = "mode-permissions";
export const WORKSPACE_ROOT_APPROVED_KEY = "workspace-root-approved";
export const SYSTEM_FILE_SCOPE_APPROVED_KEY = "system-file-scope-approved";

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

interface PersistedWorkspaceRootApproval {
  sessionId?: unknown;
  root?: unknown;
}

interface PersistedSystemFileScopeApproval {
  sessionId?: unknown;
  root?: unknown;
}

export interface ConfiguredToolPolicy {
  unknownTools: ConfiguredPolicyAction;
  bash: ConfiguredPolicyAction;
}

export interface PermissionSession {
  readonly pi: ExtensionAPI;
  level(): PermissionLevel;
  configured(): ConfiguredToolPolicy;
  additionalWorkspaceRoots(): string[];
  isAdditionalWorkspaceRoot(root: string): boolean;
  systemFileRoots(): string[];
  isSystemFileRoot(root: string): boolean;
  authorizeWorkspaceRoot(
    path: string,
    ctx: ExtensionContext,
    epoch?: number,
  ): Promise<{ approved: boolean; root?: string; reason?: string }>;
  authorizeSystemFileRoot(
    path: string,
    ctx: ExtensionContext,
    epoch?: number,
  ): Promise<{ approved: boolean; root?: string; reason?: string }>;
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
  let additionalRoots = new Set<string>();
  let systemFileRoots = new Set<string>();

  function trustedWriteScopeRoot(
    ctx: ExtensionContext,
    input: string,
  ): string | undefined {
    const root = canonicalWorkspaceRoot(resolve(ctx.cwd, input));
    if (!root || root === "/") return undefined;
    const hardSystemRoots = [
      "/etc",
      "/usr",
      "/bin",
      "/sbin",
      "/boot",
      "/var",
      "/proc",
      "/sys",
      "/dev",
    ];
    if (hardSystemRoots.some((systemRoot) => isInside(systemRoot, root))) {
      return undefined;
    }
    return root;
  }

  function validSystemFileRoot(
    path: string,
    ctx: ExtensionContext,
  ): string | undefined {
    const systemRoot = resolveSystemWorkspaceRoot(ctx.cwd);
    if (!systemRoot || getPiLaunchProfile() !== "system") return undefined;
    const root = canonicalWorkspaceRoot(resolve(ctx.cwd, path));
    if (
      !root ||
      root === "/" ||
      root === systemRoot ||
      isInside(root, systemRoot) ||
      isInside(systemRoot, root) ||
      gitWorkspaceRootForPath(root) !== root
    ) {
      return undefined;
    }
    const hardSystemRoots = [
      "/etc",
      "/usr",
      "/bin",
      "/sbin",
      "/boot",
      "/var",
      "/proc",
      "/sys",
      "/dev",
    ];
    if (
      hardSystemRoots.some((systemRootPath) => isInside(systemRootPath, root))
    ) {
      return undefined;
    }
    return root;
  }

  function currentSystemFileRoots(): string[] {
    if (
      !activeContext ||
      getPiLaunchProfile() !== "system" ||
      !resolveSystemWorkspaceRoot(activeContext.cwd)
    ) {
      return [];
    }
    const roots: string[] = [];
    for (const root of systemFileRoots) {
      if (validSystemFileRoot(root, activeContext) === root) roots.push(root);
    }
    return roots;
  }

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

  const session: PermissionSession = {
    pi,
    level: () => permissionLevel,
    configured: () => configuredPolicy,
    additionalWorkspaceRoots: () => [...additionalRoots],
    isAdditionalWorkspaceRoot: (root) => additionalRoots.has(root),
    systemFileRoots: currentSystemFileRoots,
    isSystemFileRoot: (root) => currentSystemFileRoots().includes(root),
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

    async authorizeWorkspaceRoot(path, ctx, epoch = sessionEpoch) {
      if (getPiLaunchProfile() === "system") {
        return {
          approved: false,
          reason:
            "workspace_add erteilt im Systemprofil keinen Projekt-Trust. Externe Datei-Scopes werden bei nativen Dateiwerkzeugen separat bestätigt.",
        };
      }
      if (epoch !== sessionEpoch || ctx !== activeContext) {
        return { approved: false, reason: "Die Sitzung hat sich geändert." };
      }
      if (!ctx.hasUI) {
        return {
          approved: false,
          reason:
            "Zusätzliche Projektwurzeln benötigen eine UI-Freigabe; dieser Modus hat keinen Bestätigungsdialog.",
        };
      }
      const root = trustedWriteScopeRoot(ctx, path);
      if (!root) {
        return {
          approved: false,
          reason:
            "Der Projektpfad ist kein erreichbares Verzeichnis oder liegt in einem geschützten Systembereich.",
        };
      }
      if (additionalRoots.has(root)) return { approved: true, root };

      const currentRoot = canonicalWorkspaceRoot(ctx.cwd) ?? resolve(ctx.cwd);
      const confirmed = await ctx.ui.confirm(
        "Zusätzliche Projektwurzel für diese Sitzung freigeben?",
        `Pi erhält Zugriff auf ${root} als zusätzliches Projekt. Die aktuelle Berechtigungsstufe gilt dort weiter. Projektkonfiguration und Prüfprofile dieser Wurzel gelten nach der Freigabe als vertrauenswürdig. Die Freigabe endet mit dieser Sitzung.`,
      );
      if (
        !confirmed ||
        epoch !== sessionEpoch ||
        ctx !== activeContext ||
        currentRoot !== (canonicalWorkspaceRoot(ctx.cwd) ?? resolve(ctx.cwd))
      ) {
        return {
          approved: false,
          root,
          reason: "Freigabe abgelehnt oder Sitzung gewechselt.",
        };
      }
      additionalRoots.add(root);
      pi.appendEntry(WORKSPACE_ROOT_APPROVED_KEY, {
        sessionId: activeSessionId,
        root,
        approvedAt: new Date().toISOString(),
      });
      return { approved: true, root };
    },

    async authorizeSystemFileRoot(path, ctx, epoch = sessionEpoch) {
      if (getPiLaunchProfile() !== "system") {
        return {
          approved: false,
          reason: "System-Datei-Scopes sind nur im Systemprofil verfügbar.",
        };
      }
      if (
        epoch !== sessionEpoch ||
        ctx !== activeContext ||
        typeof activeSessionId !== "string" ||
        activeSessionId.length === 0
      ) {
        return { approved: false, reason: "Die Sitzung hat sich geändert." };
      }
      if (!ctx.hasUI) {
        return {
          approved: false,
          reason:
            "Externe Datei-Scopes benötigen eine sichtbare UI-Freigabe; dieser Modus hat keinen Bestätigungsdialog.",
        };
      }
      const systemRoot = resolveSystemWorkspaceRoot(ctx.cwd);
      const root = validSystemFileRoot(path, ctx);
      if (!systemRoot || !root) {
        return {
          approved: false,
          reason:
            "Externer Datei-Scope abgelehnt: erwartet wird eine erreichbare, kanonische Git-Projektwurzel außerhalb des privaten System-Workspace.",
        };
      }
      if (currentSystemFileRoots().includes(root)) {
        return { approved: true, root };
      }

      let confirmed = false;
      try {
        confirmed = await ctx.ui.confirm(
          "Datei-Scope für diese Sitzung freigeben?",
          `Pi darf native read/grep/find/ls/write/edit-Aufrufe unter ${root} nach der aktuellen Berechtigungsstufe ausführen. Diese Freigabe gilt nur für diese Sitzung und ändert weder Projekt-Trust, Projekt-Setup oder Verifikationsprofile noch Bash-Rechte. Secret-, Symlink-, geschützte Datei-, Recovery- und Planmodus-Gates bleiben bestehen.`,
        );
      } catch {
        confirmed = false;
      }
      if (
        !confirmed ||
        epoch !== sessionEpoch ||
        ctx !== activeContext ||
        activeSessionId !== ctx.sessionManager.getSessionId() ||
        resolveSystemWorkspaceRoot(ctx.cwd) !== systemRoot ||
        validSystemFileRoot(root, ctx) !== root
      ) {
        return {
          approved: false,
          root,
          reason: confirmed
            ? "Datei-Scope verworfen: Die Sitzung, der private Workspace oder die kanonische Projektwurzel hat sich während der Freigabe geändert."
            : "Datei-Scope vom Benutzer abgelehnt.",
        };
      }
      systemFileRoots.add(root);
      pi.appendEntry(SYSTEM_FILE_SCOPE_APPROVED_KEY, {
        sessionId: activeSessionId,
        root,
        approvedAt: new Date().toISOString(),
      });
      return { approved: true, root };
    },

    async toggleYolo(ctx, source, epoch = sessionEpoch, level) {
      if (epoch !== sessionEpoch) return;
      const active = permissionState === "YOLO_OVERRIDE";
      const turnOff =
        active && (level === undefined || level === permissionLevel);
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
      additionalRoots = new Set();
      systemFileRoots = new Set();
      const approvalEntries = ctx.sessionManager
        .getEntries()
        .filter(
          (entry: { type: string; customType?: string; data?: unknown }) =>
            entry.type === "custom" &&
            entry.customType === WORKSPACE_ROOT_APPROVED_KEY,
        ) as Array<{ data?: PersistedWorkspaceRootApproval }>;
      for (const entry of approvalEntries) {
        const approval = entry.data;
        if (
          approval?.sessionId !== activeSessionId ||
          typeof approval.root !== "string"
        ) {
          continue;
        }
        const root = canonicalWorkspaceRoot(approval.root);
        if (root === approval.root && root !== "/") additionalRoots.add(root);
      }
      if (
        getPiLaunchProfile() === "system" &&
        typeof activeSessionId === "string" &&
        activeSessionId.length > 0 &&
        resolveSystemWorkspaceRoot(ctx.cwd)
      ) {
        const systemFileApprovalEntries = ctx.sessionManager
          .getEntries()
          .filter(
            (entry: { type: string; customType?: string; data?: unknown }) =>
              entry.type === "custom" &&
              entry.customType === SYSTEM_FILE_SCOPE_APPROVED_KEY,
          ) as Array<{ data?: PersistedSystemFileScopeApproval }>;
        for (const entry of systemFileApprovalEntries) {
          const approval = entry.data;
          if (
            approval?.sessionId !== activeSessionId ||
            typeof approval.root !== "string"
          ) {
            continue;
          }
          if (validSystemFileRoot(approval.root, ctx) === approval.root) {
            systemFileRoots.add(approval.root);
          }
        }
      }
      if (getPiLaunchProfile() === "system") additionalRoots.clear();
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
      // A frontend host can answer confirmations, so a persisted "headless"
      // (written before the host had a confirm channel) is not a choice.
      const confirmChannel = hasFrontendConfirmChannel();
      const restoredLevel = isYoloLevel(normalizedPersistedLevel)
        ? "project-write"
        : confirmChannel && normalizedPersistedLevel === "headless"
          ? undefined
          : normalizedPersistedLevel;
      // Phase 2.3: a fresh session (no prior persisted choice in this
      // project) outside the TUI has no confirm dialog available at all.
      // Defaulting it to "project-write" - as every session got before -
      // meant any command needing a dialog silently failed or hung with no
      // clear signal why. A TUI session keeps today's default unchanged; any
      // project with a prior persisted choice (in any mode) keeps respecting
      // that choice, regardless of mode.
      // Behind a frontend host the confirm channel exists. The System profile
      // then works openly ("project-write" = open policy with up-front
      // confirmation of deletions and other risks, see system-open-policy.ts);
      // the project profile asks for everything that is not plainly
      // inspecting ("confirm-all") instead of denying.
      const freshDefaultLevel: PermissionLevel =
        ctx.mode === "tui"
          ? "project-write"
          : confirmChannel
            ? getPiLaunchProfile() === "system"
              ? "project-write"
              : "confirm-all"
            : "headless";
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
      additionalRoots.clear();
      systemFileRoots.clear();
      setTuiStatus(ctx, UI_STATUS_KEYS.permissions, undefined);
    },
  };

  pi.events.on(WORKSPACE_SCOPE_EVENTS.request, (value) => {
    const request = value as Partial<WorkspaceScopeRequest>;
    if (!activeContext || !request.respond) return;
    if (
      request.sessionId !== undefined &&
      request.sessionId !== activeSessionId
    ) {
      request.respond({ additionalRoots: [] });
      return;
    }
    if (request.cwd !== undefined && request.cwd !== activeContext.cwd) {
      request.respond({ additionalRoots: [] });
      return;
    }
    request.respond({
      sessionId: activeSessionId,
      additionalRoots: [...additionalRoots],
    });
  });
  return session;
}
