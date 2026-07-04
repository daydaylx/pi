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
} from "./shared/permission-policy.ts";
import {
  PERMISSION_REQUEST_EVENT,
  PERMISSION_LEVEL_LABEL,
  WORKFLOW_STATUS_EVENT,
  type PermissionRequest,
  type PermissionLevel,
  type WriteOverride,
} from "./shared/workflow-status.ts";

const STATUS_KEY = "workflow-permission";
const PERSISTED_STATE_KEY = "mode-permissions";
const MAX_PREVIEW = 140;

// Auto-YOLO: aktiviert YOLO bei jedem Session-Start automatisch. Auf false
// setzen, um das alte Verhalten (keine automatische Eskalation) wieder-
// herzustellen. Die Permission-Stufe ist vom Workflow-Modus unabhängig und
// jederzeit per /yolo oder Strg+Shift+Y änderbar.
const AUTO_YOLO_ON_START = true;

const WRITE_OVERRIDE_LABEL: Record<WriteOverride, string> = {
  inherit: "Standard der Permission-Stufe",
  block: "Blockiert",
  "plan-file-only": "Nur Plan-Datei",
};

function preview(value: string): string {
  const oneLine = value.replace(/\s+/g, " ").trim();
  return oneLine.length <= MAX_PREVIEW
    ? oneLine
    : `${oneLine.slice(0, MAX_PREVIEW - 1)}…`;
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
    return decideFileAccess(
      permissionLevel,
      "write",
      toolPath(event) ?? "",
      cwd,
      writeOverride,
    );
  }

  if (
    (permissionLevel === "read-only" ||
      permissionLevel === "read-bash") &&
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
): Promise<boolean> {
  if (decision.action === "allow") return true;
  if (decision.action === "block") return false;
  if (!ctx.hasUI || ctx.mode !== "tui") return false;

  const title = decision.hard
    ? "HARTE WARNUNG — Aktion bestätigen?"
    : "Riskante Aktion bestätigen?";
  return ctx.ui.confirm(title, `${decision.reason}\n\n${preview(subject)}`);
}

export default function modePermissionsExtension(pi: ExtensionAPI): void {
  let permissionLevel: PermissionLevel = AUTO_YOLO_ON_START
    ? "yolo"
    : "read-write";
  let writeOverride: WriteOverride = "inherit";
  let activeContext: ExtensionContext | undefined;

  function publishStatus(ctx: ExtensionContext): void {
    const text =
      permissionLevel === "yolo" || permissionLevel === "full-access"
        ? ctx.ui.theme.fg(
            "warning",
            `PERM ${PERMISSION_LEVEL_LABEL[permissionLevel].toUpperCase()}`,
          )
        : `PERM ${PERMISSION_LEVEL_LABEL[permissionLevel].toUpperCase()}`;
    ctx.ui.setStatus(STATUS_KEY, text);
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

    if (level === "full-access" || level === "yolo") {
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
          : "Git-Housekeeping (reset/clean/force-push) und Paketmanager-Installationen werden ohne Rückfrage erlaubt. sudo, Löschungen, externe Schreibzugriffe und kritische Befehle bleiben bestätigt.";
      const confirmed = await ctx.ui.confirm(
        `${PERMISSION_LEVEL_LABEL[level]} für diese Session aktivieren?`,
        confirmText,
      );
      if (!confirmed) return;
    }

    permissionLevel = level;
    publishStatus(ctx);
    persistState();
    ctx.ui.notify(`Zugriffsstufe: ${PERMISSION_LEVEL_LABEL[level]}.`, "info");
  }

  pi.events.on(PERMISSION_REQUEST_EVENT, (request: PermissionRequest) => {
    void applyPermissionLevel(request.level, request.ctx);
  });

  pi.registerCommand("yolo", {
    description: "Session-weiten YOLO Mode bestätigt ein-/ausschalten",
    handler: async (_args, ctx) =>
      applyPermissionLevel(
        permissionLevel === "yolo" ? "read-write" : "yolo",
        ctx,
      ),
  });

  pi.registerCommand("full-access", {
    description: "Session-weiten Full Access Mode bestätigt ein-/ausschalten",
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
      writeOverride = next;
      if (activeContext) publishStatus(activeContext);
      persistState();
      ctx.ui.notify(`Schreibrechte: ${WRITE_OVERRIDE_LABEL[next]}.`, "info");
    },
  });

  pi.registerShortcut("ctrl+shift+y", {
    description: "YOLO Mode bestätigt ein-/ausschalten",
    handler: async (ctx) =>
      applyPermissionLevel(
        permissionLevel === "yolo" ? "read-write" : "yolo",
        ctx,
      ),
  });

  pi.on("tool_call", async (event, ctx) => {
    const decision = decideTool(
      permissionLevel,
      event,
      ctx.cwd,
      writeOverride,
    );
    const subject =
      event.toolName === "bash"
        ? String((event.input as Record<string, unknown>).command ?? "")
        : `${event.toolName}: ${toolPath(event) ?? ""}`;
    if (await approve(decision, subject, ctx)) return;

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
    if (await approve(decision, event.command, ctx)) return;
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
    activeContext = ctx;
    const latestState = ctx.sessionManager.getEntries()
      .filter(
        (entry: { type: string; customType?: string }) =>
          entry.type === "custom" && entry.customType === PERSISTED_STATE_KEY,
      )
      .pop() as {
      data?: {
        permissionLevel?: PermissionLevel;
        writeOverride?: WriteOverride;
      };
    } | undefined;
    permissionLevel =
      latestState?.data?.permissionLevel ??
      (AUTO_YOLO_ON_START ? "yolo" : "read-write");
    writeOverride = latestState?.data?.writeOverride ?? "inherit";
    publishStatus(ctx);
    if (
      !latestState &&
      AUTO_YOLO_ON_START &&
      permissionLevel === "yolo" &&
      ctx.mode === "tui"
    ) {
      ctx.ui.notify(
        "YOLO automatisch aktiv. /yolo zum Deaktivieren.",
        "warning",
      );
    }
  });

  pi.on("session_shutdown", async () => {
    activeContext = undefined;
  });
}
