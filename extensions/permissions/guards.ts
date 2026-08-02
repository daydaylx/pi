import type { ExtensionAPI, ExtensionContext, ToolCallEvent } from "@earendil-works/pi-coding-agent";
import { requestGrant } from "../shared/permission-dialog.ts";
import { decideBash } from "../shared/permission-policy.ts";
import { requestWorkflowCapabilities } from "../shared/workflow-capabilities.ts";
import { isPlanningMode } from "../shared/workflow-mode.ts";
import type { PermissionSession } from "./session-state.ts";
import { decideTool } from "./tool-policy.ts";
import {
  assessBash,
  assessWorkflowTool,
  automaticallyAllowedInPlanMode,
} from "./workflow-policy.ts";
import { toolPath } from "./tool-event.ts";

const READ_ONLY_TOOLS = ["read", "grep", "find", "ls", "ask_user"];

async function approveWorkflowAction(
  session: PermissionSession,
  assessment: ReturnType<typeof assessWorkflowTool> | ReturnType<typeof assessBash>,
  subject: string,
  ctx: ExtensionContext,
): Promise<boolean> {
  if (assessment.classification === "hard-block") return false;
  if (session.hasGrant(assessment.descriptor, ctx.cwd)) return true;
  if (assessment.classification === "safe-read") return true;
  const choice = await requestGrant(ctx, {
    subject,
    toolName: assessment.descriptor.tool,
    reason: assessment.reason,
    impacts: assessment.impacts,
    persistable: assessment.descriptor.persistable,
  });
  if (choice === "deny") return false;
  if (choice !== "once") session.saveGrant(choice, assessment.descriptor, ctx.cwd);
  return true;
}

export function registerPermissionGuards(pi: ExtensionAPI, session: PermissionSession): void {
  pi.on("tool_call", async (event: ToolCallEvent, ctx) => {
    if (!ctx.isProjectTrusted() && !READ_ONLY_TOOLS.includes(event.toolName)) {
      return { block: true, reason: "Harte Trust-Grenze: mutierende oder externe Tools sind im nicht vertrauenswürdigen Projekt blockiert." };
    }
    const workflow = requestWorkflowCapabilities(pi.events);
    const assessment = assessWorkflowTool(event, ctx.cwd);
    const subject = event.toolName === "bash"
      ? String((event.input as Record<string, unknown>).command ?? "")
      : `${event.toolName}: ${toolPath(event) ?? ""}`;
    if (assessment.classification === "hard-block") {
      return { block: true, reason: assessment.reason };
    }
    if (session.hasGrant(assessment.descriptor, ctx.cwd) || automaticallyAllowedInPlanMode(workflow, event, ctx.cwd)) return;
    if (isPlanningMode(workflow.mode)) {
      if (await approveWorkflowAction(session, assessment, subject, ctx)) return;
      return { block: true, reason: "Freigabe fehlt oder wurde abgelehnt." };
    }
    const decision = decideTool(session.level(), event, ctx.cwd, session.configured());
    if (decision.action === "allow") return;
    if (await approveWorkflowAction(session, assessment, subject, ctx)) return;
    return { block: true, reason: decision.action === "block" ? decision.reason : "Freigabe fehlt oder wurde abgelehnt." };
  });

  pi.on("user_bash", async (event, ctx: ExtensionContext) => {
    if (!ctx.isProjectTrusted()) {
      return { result: { output: "Harte Trust-Grenze: Shell-Zugriff ist im nicht vertrauenswürdigen Projekt blockiert.", exitCode: 126, cancelled: true, truncated: false } };
    }
    const workflow = requestWorkflowCapabilities(pi.events);
    const assessment = assessBash(event.command, event.cwd);
    let allowed = false;
    if (assessment.classification !== "hard-block" && session.hasGrant(assessment.descriptor, event.cwd)) {
      allowed = true;
    } else if (assessment.classification !== "hard-block" && isPlanningMode(workflow.mode)) {
      allowed = await approveWorkflowAction(session, assessment, event.command, ctx);
    } else if (assessment.classification !== "hard-block") {
      const generic = decideBash(session.level(), event.command, event.cwd);
      allowed = generic.action === "allow" || await approveWorkflowAction(session, assessment, event.command, ctx);
    }
    if (allowed) return;
    return { result: { output: assessment.classification === "hard-block" ? assessment.reason : "Freigabe fehlt oder wurde abgelehnt.", exitCode: 126, cancelled: true, truncated: false } };
  });
}
