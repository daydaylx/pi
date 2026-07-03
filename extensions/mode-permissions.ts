/**
 * Central permission decision layer for Plan, Work and session-scoped
 * escalation (Full Access, YOLO).
 *
 * This is intentionally the only extension that intercepts tool_call and
 * user_bash. Workflow extensions publish the base mode but do not make access
 * decisions themselves.
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
  PERMISSION_LEVEL_LABEL,
  WORKFLOW_STATUS_EVENT,
  type BaseMode,
  type Escalation,
  type PermissionLevel,
  type RuntimeMode,
  type WorkflowStatusEvent,
  type WriteOverride,
} from "./shared/workflow-status.ts";

const STATUS_KEY = "workflow-mode";
const MAX_PREVIEW = 140;

const WRITE_OVERRIDE_LABEL: Record<WriteOverride, string> = {
  inherit: "Erlaubt (Standard des Modus)",
  block: "Blockiert",
  "plan-file-only": "Nur Plan-Datei",
};

const PLAN_PERMISSION_LEVELS = new Set<PermissionLevel>([
  "read-only",
  "read-bash",
]);

function escalationLabel(level: Escalation): string {
  return level === "none"
    ? "normaler Work Mode"
    : PERMISSION_LEVEL_LABEL[level];
}

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
  mode: RuntimeMode,
  event: ToolCallEvent,
  cwd: string,
  planStrict: boolean,
  writeOverride: WriteOverride,
): PolicyDecision {
  if (event.toolName === "bash") {
    return decideBash(
      mode,
      String((event.input as Record<string, unknown>).command ?? ""),
      cwd,
      { planStrict, writeOverride },
    );
  }

  if (
    event.toolName === "read" ||
    event.toolName === "grep" ||
    event.toolName === "find" ||
    event.toolName === "ls"
  ) {
    return decideFileAccess(mode, "read", toolPath(event) ?? ".", cwd);
  }

  if (event.toolName === "write" || event.toolName === "edit") {
    return decideFileAccess(
      mode,
      "write",
      toolPath(event) ?? "",
      cwd,
      writeOverride,
    );
  }

  if (mode === "plan" && event.toolName !== "ask_user") {
    return {
      action: "block",
      reason: `Plan Mode: Tool "${event.toolName}" ist nicht freigegeben.`,
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
  let baseMode: BaseMode = "work";
  let escalation: Escalation = "none";
  let planStrict = false;
  let writeOverride: WriteOverride = "inherit";
  let activeContext: ExtensionContext | undefined;

  // Full Access/YOLO wirken ausschließlich im Work Mode. Das verhindert, dass
  // eine im Plan Mode voreingestellte Eskalation dessen Read-only-Garantie
  // umgeht, sobald baseMode später auf "work" wechselt.
  function runtimeMode(): RuntimeMode {
    return baseMode === "work" && escalation !== "none" ? escalation : baseMode;
  }

  function permissionLevel(): PermissionLevel {
    if (baseMode === "plan") return planStrict ? "read-only" : "read-bash";
    if (escalation === "full-access") return "full-access";
    if (escalation === "yolo") return "yolo";
    return "read-write";
  }

  function publishStatus(ctx: ExtensionContext): void {
    const mode = runtimeMode();
    const text =
      mode === "yolo"
        ? ctx.ui.theme.fg("warning", "MODE YOLO")
        : mode === "full-access"
          ? ctx.ui.theme.fg("warning", "MODE FULL ACCESS")
          : mode === "plan"
            ? ctx.ui.theme.fg("accent", "MODE PLAN")
            : "MODE WORK";
    ctx.ui.setStatus(STATUS_KEY, text);
    pi.events.emit(WORKFLOW_STATUS_EVENT, {
      source: "permission",
      mode,
      baseMode,
      yolo: escalation === "yolo",
      escalation,
      planStrict,
      writeOverride,
      permissionLevel: permissionLevel(),
    } satisfies WorkflowStatusEvent);
  }

  pi.events.on(WORKFLOW_STATUS_EVENT, (event: WorkflowStatusEvent) => {
    if (event.source !== "plan") return;
    // plan-mode blockiert Moduswechsel selbst, solange eine Eskalation aktiv
    // in Work Mode wirkt (siehe escalationActive dort) — daher kann baseMode
    // hier immer übernommen werden, auch um eine vorgemerkte Eskalation beim
    // Wechsel nach Work scharf zu schalten.
    baseMode = event.baseMode;
    if (activeContext) publishStatus(activeContext);
  });

  async function setEscalation(
    target: Escalation,
    ctx: ExtensionContext,
  ): Promise<void> {
    if (ctx.mode !== "tui") {
      ctx.ui.notify(
        "Eskalationsstufe kann nur interaktiv geändert werden.",
        "error",
      );
      return;
    }
    if (!ctx.isIdle()) {
      ctx.ui.notify(
        "Eskalationsstufe kann nur im Leerlauf geändert werden.",
        "info",
      );
      return;
    }
    if (target === escalation) return;

    if (target === "none") {
      const confirmed = await ctx.ui.confirm(
        `${escalationLabel(escalation)} deaktivieren?`,
        "Zurück zu normalem Work Mode.",
      );
      if (!confirmed) return;
      escalation = "none";
      publishStatus(ctx);
      ctx.ui.notify("Eskalation aus. Modus: WORK.", "info");
      return;
    }

    const confirmText =
      target === "yolo"
        ? "Normale Work-Rückfragen werden umgangen. Systempfade, Secrets, SSH-Keys, sudo, Löschungen und extreme Befehle bleiben hart bestätigt."
        : "Git-Housekeeping (reset/clean/force-push) und Paketmanager-Installationen werden ohne Rückfrage erlaubt. sudo, Löschungen, externe Schreibzugriffe und kritische Befehle bleiben bestätigt.";
    const confirmed = await ctx.ui.confirm(
      `${escalationLabel(target)} für diese Session aktivieren?`,
      confirmText,
    );
    if (!confirmed) return;
    escalation = target;
    publishStatus(ctx);
    ctx.ui.notify(
      baseMode === "work"
        ? `${escalationLabel(target)} aktiv.`
        : `${escalationLabel(target)} vorgemerkt — wird aktiv, sobald Work Mode läuft.`,
      "warning",
    );
  }

  async function applyPermissionLevel(
    level: PermissionLevel,
    ctx: ExtensionContext,
  ): Promise<void> {
    if (ctx.mode !== "tui") {
      ctx.ui.notify(
        "Zugriffsstufe kann nur interaktiv geändert werden.",
        "error",
      );
      return;
    }
    if (!ctx.isIdle()) {
      ctx.ui.notify(
        "Zugriffsstufe kann nur im Leerlauf geändert werden.",
        "info",
      );
      return;
    }

    if (PLAN_PERMISSION_LEVELS.has(level)) {
      planStrict = level === "read-only";
      if (activeContext) publishStatus(activeContext);
      if (baseMode === "plan") {
        ctx.ui.notify(
          `Zugriffsstufe: ${PERMISSION_LEVEL_LABEL[level]}.`,
          "info",
        );
        return;
      }
      ctx.ui.setEditorText("/plan");
      ctx.ui.notify(
        `${PERMISSION_LEVEL_LABEL[level]} vorgemerkt — /plan ausführen, um Plan Mode zu aktivieren.`,
        "info",
      );
      return;
    }

    const target: Escalation =
      level === "full-access"
        ? "full-access"
        : level === "yolo"
          ? "yolo"
          : "none";
    await setEscalation(target, ctx);
    if (baseMode !== "work") {
      ctx.ui.setEditorText("/work");
    }
  }

  pi.registerCommand("yolo", {
    description: "Session-weiten YOLO Mode bestätigt ein-/ausschalten",
    handler: async (_args, ctx) =>
      setEscalation(escalation === "yolo" ? "none" : "yolo", ctx),
  });

  pi.registerCommand("full-access", {
    description: "Session-weiten Full Access Mode bestätigt ein-/ausschalten",
    handler: async (_args, ctx) =>
      setEscalation(escalation === "full-access" ? "none" : "full-access", ctx),
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
      ctx.ui.notify(`Schreibrechte: ${WRITE_OVERRIDE_LABEL[next]}.`, "info");
    },
  });

  pi.registerShortcut("ctrl+shift+y", {
    description: "YOLO Mode bestätigt ein-/ausschalten",
    handler: async (ctx) =>
      setEscalation(escalation === "yolo" ? "none" : "yolo", ctx),
  });

  pi.on("tool_call", async (event, ctx) => {
    const decision = decideTool(
      runtimeMode(),
      event,
      ctx.cwd,
      planStrict,
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
    const decision = decideBash(runtimeMode(), event.command, event.cwd, {
      planStrict,
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
    // Eskalation (Full Access/YOLO) wird bewusst nie aus der Session
    // wiederhergestellt.
    activeContext = ctx;
    escalation = "none";
    planStrict = false;
    writeOverride = "inherit";
    publishStatus(ctx);
  });

  pi.on("session_shutdown", async () => {
    escalation = "none";
    activeContext = undefined;
  });
}
