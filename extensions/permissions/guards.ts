/**
 * The tool_call and user_bash interceptors.
 *
 * This is the only place in the extension stack that blocks a tool or a shell
 * command. The order is fixed: the hard trust boundary first (an untrusted
 * project allows nothing mutating or external, whatever the level says), then
 * the workflow decision, then the permission level.
 *
 * A decision that needs confirmation but cannot ask — no UI, not a TUI, or the
 * user declined — always resolves to blocked, never to allowed.
 */
import type {
  ExtensionAPI,
  ExtensionContext,
  ToolCallEvent,
} from "@earendil-works/pi-coding-agent";
import { confirmAction } from "../shared/permission-dialog.ts";
import {
  decideBash,
  type PolicyDecision,
} from "../shared/permission-policy.ts";
import { requestWorkflowCapabilities } from "../shared/workflow-capabilities.ts";
import type { PermissionSession } from "./session-state.ts";
import { toolPath } from "./tool-event.ts";
import { decideTool } from "./tool-policy.ts";
import {
  isRestrictedWorkflow,
  referencesWorkflowArtifact,
} from "./workflow-policy.ts";

const READ_ONLY_TOOLS = ["read", "grep", "find", "ls", "ask_user"];

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

export function registerPermissionGuards(
  pi: ExtensionAPI,
  session: PermissionSession,
): void {
  pi.on("tool_call", async (event: ToolCallEvent, ctx) => {
    if (!ctx.isProjectTrusted() && !READ_ONLY_TOOLS.includes(event.toolName)) {
      return {
        block: true,
        reason:
          "Harte Trust-Grenze: mutierende oder externe Tools sind im nicht vertrauenswürdigen Projekt blockiert.",
      };
    }
    const decision = decideTool(
      session.level(),
      event,
      ctx.cwd,
      requestWorkflowCapabilities(pi.events),
      session.configured(),
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
    const configured = session.configured();
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
        : session.level() === "project-write" && configured.bash !== "allow"
          ? configured.bash === "block"
            ? {
                action: "block" as const,
                reason: "Bash ist in der Setup-Policy gesperrt.",
              }
            : {
                action: "ask" as const,
                reason: "Freier Shell-Zugriff benötigt Bestätigung.",
              }
          : decideBash(session.level(), event.command, event.cwd);
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
}
