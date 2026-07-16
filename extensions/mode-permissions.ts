/**
 * Central permission decision layer, independent from the workflow mode.
 *
 * This is intentionally the only extension that intercepts tool_call and
 * user_bash. Workflow extensions do not make access decisions themselves.
 */

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
import { runMenu, type MenuEntry } from "./shared/menu-ui.ts";
import { buildPermissionMenu } from "./shared/permission-menu.ts";
import { buildThinkingMenu } from "./shared/thinking-menu.ts";
import { SHORTCUTS } from "./shared/shortcuts.ts";
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

function permissionWarning(level: PermissionLevel): string | undefined {
  if (level === "full-access") {
    return "FULL ACCESS aktiv: Sudo, Löschen, externe Schreibzugriffe und Force-Push bleiben bestätigt.";
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
  configured: {
    unknownTools: ConfiguredPolicyAction;
    bash: ConfiguredPolicyAction;
  },
): PolicyDecision {
  if (event.toolName === "bash") {
    if (permissionLevel === "read-write") {
      if (configured.bash === "block") {
        return { action: "block", reason: "Bash ist in der Setup-Policy gesperrt." };
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
    return { action: "allow", reason: "Read-only LSP capability" };
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
  if (permissionLevel === "full-access" || permissionLevel === "yolo") {
    return { action: "allow", reason: "Erweiterte Zugriffsstufe" };
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
      return { action: "allow", reason: "Explizit durch Setup-Policy erlaubt" };
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
    pi.appendEntry(PERSISTED_STATE_KEY, { permissionLevel });
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
    const level = await runMenu(
      ctx,
      "Thinking",
      buildThinkingMenu(pi.getThinkingLevel()),
      { fallbackPrompt: "Thinking-Level wählen" },
    );
    if (!level) return;
    pi.setThinkingLevel(level);
    ctx.ui.notify(`Thinking-Level: ${level}.`, "info");
  }

  // Zentrales Befehlsmenü (Ctrl+Shift+X): früher in actions.ts als reiner
  // Event-Router über fünf shared/*-menu.ts-Bausteine. Da diese Extension die
  // einzige Zuständige für Permission-/Thinking-Aktionen ist, ruft sie die
  // eigenen Funktionen jetzt direkt auf. Plan-Aktionen (/plan, /decide, /work
  // …) bleiben ausschließlich über ihre eigenen Slash-Commands und den
  // Plan-Assistenten (Ctrl+Alt+P) erreichbar.
  type CommandMenuTarget =
    | "open-permission-menu"
    | "toggle-yolo"
    | "open-thinking-menu";

  function buildCommandMenu(): MenuEntry<CommandMenuTarget>[] {
    return [
      {
        id: "cmd-permission",
        section: "Berechtigungen",
        label: "/permission",
        description: "Zugriffsstufe wählen: nur lesen bis YOLO",
        value: "open-permission-menu",
      },
      {
        id: "cmd-yolo",
        section: "Berechtigungen",
        label: "/yolo",
        description: "YOLO-Modus für diese Sitzung ein- oder ausschalten",
        value: "toggle-yolo",
        current: permissionLevel === "yolo",
      },
      {
        id: "cmd-thinking",
        section: "Denken",
        label: "/thinking",
        description: "Denkstufe wählen: Minimal bis XHigh",
        value: "open-thinking-menu",
      },
    ];
  }

  async function openCommandMenu(ctx: ExtensionContext): Promise<void> {
    const selected = await runMenu(ctx, "Befehle", buildCommandMenu(), {
      fallbackPrompt: "Befehl wählen",
    });
    if (!selected) return;
    switch (selected) {
      case "open-permission-menu":
        await openPermissionMenu(ctx);
        return;
      case "toggle-yolo":
        await applyPermissionLevel(
          permissionLevel === "yolo" ? "read-write" : "yolo",
          ctx,
        );
        return;
      case "open-thinking-menu":
        await openThinkingMenu(ctx);
        return;
    }
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

  pi.registerShortcut(SHORTCUTS.commandMenu.keys, {
    description: SHORTCUTS.commandMenu.description,
    handler: async (ctx) => openCommandMenu(ctx),
  });

  pi.on("tool_call", async (event, ctx) => {
    const decision = decideTool(
      permissionLevel,
      event,
      ctx.cwd,
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
    const decision =
      permissionLevel === "read-write" && configuredPolicy.bash !== "allow"
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
    configuredPolicy = loadSetupConfig(
      ctx.cwd,
      ctx.isProjectTrusted(),
    ).config.permissions;
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
