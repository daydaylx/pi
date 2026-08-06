import type {
  ExtensionAPI,
  ExtensionContext,
  ToolCallEvent,
} from "@earendil-works/pi-coding-agent";
import { confirmAction } from "../shared/permission-dialog.ts";
import { decideBash } from "../shared/permission-policy.ts";
import { requestWorkflowCapabilities } from "../shared/workflow-capabilities.ts";
import type { PermissionSession } from "./session-state.ts";
import { decideTool } from "./tool-policy.ts";
import {
  assessBash,
  assessWorkflowTool,
  automaticallyAllowedInPlanMode,
} from "./workflow-policy.ts";
import { toolPath } from "./tool-event.ts";

const READ_ONLY_TOOLS = ["read", "grep", "find", "ls", "ask_user"];

// Custom-/MCP-Tools ohne path/filePath-Feld (z. B. subagent) hätten sonst ein
// leeres Subject und der Mensch würde blind bestätigen.
const MAX_INPUT_PREVIEW = 300;

function toolSubject(event: ToolCallEvent): string {
  if (event.toolName === "bash") {
    return String((event.input as Record<string, unknown>).command ?? "");
  }
  const path = toolPath(event);
  if (path !== undefined) return `${event.toolName}: ${path}`;
  const preview = JSON.stringify(event.input ?? {}).slice(0, MAX_INPUT_PREVIEW);
  return `${event.toolName}: ${preview}`;
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
    const workflow = requestWorkflowCapabilities(pi.events);
    const assessment = assessWorkflowTool(event, ctx.cwd);
    if (assessment.blocked) {
      return { block: true, reason: assessment.reason };
    }
    if (automaticallyAllowedInPlanMode(workflow, event, ctx.cwd)) return;

    const decision = decideTool(
      session.level(),
      event,
      ctx.cwd,
      session.configured(),
    );
    if (decision.action === "allow") return;
    if (decision.action === "block") {
      return { block: true, reason: decision.reason };
    }
    const subject = toolSubject(event);
    const confirmed = await confirmAction(
      ctx,
      decision,
      subject,
      event.toolName,
    );
    if (!confirmed) {
      return { block: true, reason: "Aktion vom Benutzer abgelehnt." };
    }
  });

  pi.on("user_bash", async (event, ctx: ExtensionContext) => {
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
    const assessment = assessBash(event.command);
    if (assessment.blocked) {
      return {
        result: {
          output: assessment.reason,
          exitCode: 126,
          cancelled: true,
          truncated: false,
        },
      };
    }
    const decision = decideBash(session.level(), event.command, event.cwd);
    if (decision.action === "allow") return;
    if (decision.action === "block") {
      return {
        result: {
          output: decision.reason,
          exitCode: 126,
          cancelled: true,
          truncated: false,
        },
      };
    }
    const confirmed = await confirmAction(ctx, decision, event.command, "bash");
    if (!confirmed) {
      return {
        result: {
          output: "Aktion vom Benutzer abgelehnt.",
          exitCode: 126,
          cancelled: true,
          truncated: false,
        },
      };
    }
  });
}
