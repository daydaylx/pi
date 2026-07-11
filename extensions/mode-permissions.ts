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
  isPathWithinAllowed,
  type PolicyDecision,
} from "./shared/permission-policy.ts";
import { confirmAction } from "./shared/permission-dialog.ts";
import { runMenu } from "./shared/menu-ui.ts";
import { buildPermissionMenu } from "./shared/permission-menu.ts";
import { SHORTCUTS } from "./shared/shortcuts.ts";
import {
  PERMISSION_REQUEST_EVENT,
  PERMISSION_LEVEL_LABEL,
  WORKFLOW_STATUS_EVENT,
  WRITE_OVERRIDE_LABEL,
  WRITE_OVERRIDE_REQUEST_EVENT,
  type PermissionRequest,
  type PermissionLevel,
  type WriteOverride,
  type WriteOverrideRequest,
} from "./shared/workflow-status.ts";
import { formatPermissionWarning } from "./shared/visual-system.ts";

const STATUS_KEY = "workflow-permission";
const PERMISSION_STATUS_KEY = "permission-level";
const PERSISTED_STATE_KEY = "mode-permissions";
const CONFIRM_ELEVATED_PERMISSIONS = false;
const ENV_PERMISSION_LEVEL = "PI_SUBAGENT_PERMISSION_LEVEL";
const ENV_WRITE_OVERRIDE = "PI_SUBAGENT_WRITE_OVERRIDE";
const ENV_ALLOWED_PATHS = "PI_SUBAGENT_ALLOWED_PATHS"; // #46

// Auto-YOLO: aktiviert YOLO bei jedem Session-Start automatisch. Auf false
// setzen, um das alte Verhalten (keine automatische Eskalation) wieder-
// herzustellen. Die Permission-Stufe ist vom Workflow-Modus unabhängig und
// jederzeit per /yolo oder Strg+Shift+Y änderbar.
const AUTO_YOLO_ON_START = true;

function permissionFromEnv(): PermissionLevel | undefined {
  const value = process.env[ENV_PERMISSION_LEVEL] as
    PermissionLevel | undefined;
  return value && value in PERMISSION_LEVEL_LABEL ? value : undefined;
}

function writeOverrideFromEnv(): WriteOverride | undefined {
  const value = process.env[ENV_WRITE_OVERRIDE] as WriteOverride | undefined;
  return value === "inherit" || value === "block" || value === "plan-file-only"
    ? value
    : undefined;
}

// #46: when this process is a subagent child with a declared allowedPaths
// scope, writes outside those paths are blocked. Undefined = unrestricted.
function allowedPathsFromEnv(): string[] | undefined {
  const raw = process.env[ENV_ALLOWED_PATHS];
  if (!raw) return undefined;
  const list = raw
    .split("|")
    .map((p) => p.trim())
    .filter(Boolean);
  return list.length > 0 ? list : undefined;
}

function toolPath(event: ToolCallEvent): string | undefined {
  const input = event.input as Record<string, unknown>;
  return typeof input.path === "string" ? input.path : undefined;
}

function decideTool(
  permissionLevel: PermissionLevel,
  event: ToolCallEvent,
  cwd: string,
  writeOverride: WriteOverride,
): PolicyDecision {
  if (event.toolName === "bash") {
    return decideBash(
      permissionLevel,
      String((event.input as Record<string, unknown>).command ?? ""),
      cwd,
      { writeOverride },
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

  if (event.toolName === "write" || event.toolName === "edit") {
    const filePath = toolPath(event) ?? "";
    // #46: enforce the subagent's allowedPaths write scope if declared.
    const allowed = allowedPathsFromEnv();
    if (allowed && !isPathWithinAllowed(filePath, cwd, allowed)) {
      return {
        action: "block",
        reason: `Subagent write scope: "${filePath}" liegt außerhalb der erlaubten Pfade (${allowed.join(", ")}).`,
      };
    }
    return decideFileAccess(
      permissionLevel,
      "write",
      filePath,
      cwd,
      writeOverride,
    );
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
  return { action: "allow", reason: "Erlaubt" };
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
  let permissionLevel: PermissionLevel =
    permissionFromEnv() ?? (AUTO_YOLO_ON_START ? "yolo" : "read-write");
  let writeOverride: WriteOverride = writeOverrideFromEnv() ?? "inherit";

  function publishStatus(ctx: ExtensionContext): void {
    // Der Footer in ux-status.ts ist die einzige dauerhafte TUI-Statusquelle.
    // Beide Alt-Keys werden nur noch bereinigt.
    ctx.ui.setStatus(STATUS_KEY, undefined);
    ctx.ui.setStatus(PERMISSION_STATUS_KEY, undefined);
    pi.events.emit(WORKFLOW_STATUS_EVENT, {
      source: "permission",
      writeOverride,
      permissionLevel,
    });
  }

  function persistState(): void {
    pi.appendEntry(PERSISTED_STATE_KEY, { permissionLevel, writeOverride });
  }

  async function applyPermissionLevel(
    level: PermissionLevel,
    ctx: ExtensionContext,
  ): Promise<void> {
    if (level === permissionLevel) return;

    if (
      CONFIRM_ELEVATED_PERMISSIONS &&
      (level === "full-access" || level === "yolo")
    ) {
      if (!ctx.hasUI) {
        ctx.ui.notify(
          `${PERMISSION_LEVEL_LABEL[level]} erfordert eine interaktive Bestätigung.`,
          "error",
        );
        return;
      }
      const confirmText =
        level === "yolo"
          ? "Normale Work-Rückfragen werden umgangen. Systempfade, Secrets, SSH-Keys, sudo, Löschungen und extreme Befehle bleiben hart bestätigt."
          : "Git-Housekeeping (reset/clean) und Paketmanager-Installationen werden ohne Rückfrage erlaubt. sudo, Löschungen, Force-Push, externe Schreibzugriffe und kritische Befehle bleiben bestätigt.";
      const confirmed = await ctx.ui.confirm(
        `${PERMISSION_LEVEL_LABEL[level]} für diese Session aktivieren?`,
        confirmText,
      );
      if (!confirmed) return;
    }

    permissionLevel = level;
    publishStatus(ctx);
    persistState();
    const warning = formatPermissionWarning(level);
    ctx.ui.notify(
      warning ?? `Zugriffsstufe: ${PERMISSION_LEVEL_LABEL[level]}.`,
      warning ? "warning" : "info",
    );
  }

  async function openPermissionMenu(ctx: ExtensionContext): Promise<void> {
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
    if (!level) return;
    await applyPermissionLevel(level, ctx);
  }

  function applyWriteOverride(
    next: WriteOverride,
    ctx: ExtensionContext,
  ): void {
    writeOverride = next;
    publishStatus(ctx);
    persistState();
    ctx.ui.notify(`Schreibrechte: ${WRITE_OVERRIDE_LABEL[next]}.`, "info");
  }

  pi.events.on(PERMISSION_REQUEST_EVENT, (request: PermissionRequest) => {
    void applyPermissionLevel(request.level, request.ctx);
  });

  pi.events.on(
    WRITE_OVERRIDE_REQUEST_EVENT,
    (request: WriteOverrideRequest) => {
      applyWriteOverride(request.override, request.ctx);
    },
  );

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
      if (!(level in PERMISSION_LEVEL_LABEL)) {
        ctx.ui.notify(
          "Nutzung: /permission read-only|read-bash|read-write|full-access|yolo",
          "info",
        );
        return;
      }
      await applyPermissionLevel(level, ctx);
    },
  });

  pi.registerCommand("write", {
    description: "Schreibrechte setzen: allow | block | plan-only",
    handler: async (args, ctx) => {
      const map: Record<string, WriteOverride> = {
        allow: "inherit",
        block: "block",
        "plan-only": "plan-file-only",
      };
      const next = map[args.trim().toLowerCase()];
      if (!next) {
        ctx.ui.notify("Nutzung: /write allow|block|plan-only", "info");
        return;
      }
      applyWriteOverride(next, ctx);
    },
  });

  pi.registerShortcut(SHORTCUTS.permissionMenu.keys, {
    description: SHORTCUTS.permissionMenu.description,
    handler: async (ctx) => openPermissionMenu(ctx),
  });

  pi.on("tool_call", async (event, ctx) => {
    const decision = decideTool(permissionLevel, event, ctx.cwd, writeOverride);
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
    const decision = decideBash(permissionLevel, event.command, event.cwd, {
      writeOverride,
    });
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
            writeOverride?: WriteOverride;
          };
        }
      | undefined;
    permissionLevel =
      latestState?.data?.permissionLevel ??
      permissionFromEnv() ??
      (AUTO_YOLO_ON_START ? "yolo" : "read-write");
    writeOverride =
      latestState?.data?.writeOverride ?? writeOverrideFromEnv() ?? "inherit";
    publishStatus(ctx);
  });
}
