/**
 * Workflow-scoped tool policy.
 *
 * This layer runs *before* the permission level (Umbauvertrag: the workflow
 * decision comes first), which is why YOLO cannot lift a planning promise:
 * during planning every write outside the current plan stays blocked no
 * matter which level is active. Pure — no state, no UI, no side effects.
 */
import { relative, resolve, sep } from "node:path";
import type { ToolCallEvent } from "@earendil-works/pi-coding-agent";
import type { PolicyDecision } from "../shared/permission-policy.ts";
import { isPlanFilePath } from "../plan-mode/store/index.ts";
import type { WorkflowCapabilitySnapshot } from "../shared/workflow-capabilities.ts";
import { toolPath } from "./tool-event.ts";

export const LOCAL_LSP_TOOLS = new Set([
  "lsp_diagnostics",
  "lsp_definition",
  "lsp_references",
  "lsp_hover",
  "lsp_workspace_symbols",
]);
export const READ_ONLY_SUBAGENT_PROFILES = new Set(["planner", "reviewer"]);

export function isRestrictedWorkflow(snapshot: WorkflowCapabilitySnapshot): boolean {
  return ["planning", "reviewing", "paused", "blocked"].includes(
    snapshot.state,
  );
}

export function workflowAllowsPlanWrite(
  snapshot: WorkflowCapabilitySnapshot,
): boolean {
  return snapshot.state === "planning" || snapshot.state === "reviewing";
}

function subagentProfiles(input: unknown): string[] | undefined {
  if (!input || typeof input !== "object") return undefined;
  const value = input as Record<string, unknown>;
  if (
    value.action === "list" &&
    Object.keys(value).every((key) => key === "action")
  ) {
    return [];
  }
  if (typeof value.agent === "string" && typeof value.task === "string") {
    return [value.agent];
  }
  if (Array.isArray(value.tasks) && value.tasks.length > 0) {
    const profiles = value.tasks.map((task) =>
      task && typeof task === "object"
        ? (task as Record<string, unknown>).agent
        : undefined,
    );
    return profiles.every(
      (profile): profile is string => typeof profile === "string",
    )
      ? profiles
      : undefined;
  }
  if (Array.isArray(value.chain) && value.chain.length > 0) {
    const profiles = value.chain.map((task) =>
      task && typeof task === "object"
        ? (task as Record<string, unknown>).agent
        : undefined,
    );
    return profiles.every(
      (profile): profile is string => typeof profile === "string",
    )
      ? profiles
      : undefined;
  }
  return undefined;
}

function isManagedWorkflowArtifactPath(rawPath: string, cwd: string): boolean {
  const target = resolve(cwd, rawPath);
  const plansRoot = resolve(cwd, ".agent/plans");
  const plansRelative = relative(plansRoot, target);
  return (
    plansRelative === "" ||
    (plansRelative !== ".." && !plansRelative.startsWith(`..${sep}`)) ||
    target === resolve(cwd, ".agent/direct-task.json")
  );
}

export function referencesWorkflowArtifact(command: string): boolean {
  const normalized = command.replace(/\\/g, "/");
  return (
    normalized.includes(".agent/plans/") ||
    normalized.includes(".agent/direct-task.json")
  );
}

export function decideWorkflowTool(
  workflow: WorkflowCapabilitySnapshot,
  event: ToolCallEvent,
  cwd: string,
): PolicyDecision | undefined {
  const managedPath = toolPath(event);
  if (
    managedPath &&
    isManagedWorkflowArtifactPath(managedPath, cwd) &&
    !["read", "grep", "find", "ls"].includes(event.toolName)
  ) {
    if (event.toolName === "write" || event.toolName === "edit") {
      if (
        workflowAllowsPlanWrite(workflow) &&
        isPlanFilePath(managedPath, cwd)
      ) {
        return {
          action: "allow",
          reason: "Workflow: kontrollierter Plan-Schreibzugriff",
        };
      }
    }
    return {
      action: "block",
      reason:
        "Workflow-Artefakte dürfen nur über Plan-Mode und plan_progress aktualisiert werden.",
    };
  }
  if (
    workflow.state === "working" &&
    (event.toolName === "write" || event.toolName === "edit")
  ) {
    return undefined;
  }
  if (
    event.toolName === "bash" &&
    referencesWorkflowArtifact(
      String((event.input as Record<string, unknown>).command ?? ""),
    )
  ) {
    return {
      action: "block",
      reason:
        "Workflow-Artefakte sind über Shell gesperrt; nutze Plan-Mode, Direct-Task-Kommandos oder plan_progress.",
    };
  }
  if (!isRestrictedWorkflow(workflow)) return undefined;

  if (["read", "grep", "find", "ls"].includes(event.toolName)) return undefined;
  if (LOCAL_LSP_TOOLS.has(event.toolName)) {
    return { action: "allow", reason: "Workflow: read-only LSP capability" };
  }
  if (event.toolName === "ask_user" || event.toolName === "wait") {
    return { action: "allow", reason: "Workflow: kontrollierte Fähigkeit" };
  }
  if (event.toolName === "verify") return undefined;
  if (event.toolName === "subagent") {
    const profiles = subagentProfiles(event.input);
    return profiles &&
      profiles.every((profile) => READ_ONLY_SUBAGENT_PROFILES.has(profile))
      ? { action: "allow", reason: "Workflow: read-only Subagenten" }
      : {
          action: "block",
          reason:
            "Dieser Workflow erlaubt nur bekannte read-only Subagentenprofile.",
        };
  }
  if (event.toolName === "write" || event.toolName === "edit") {
    const filePath = toolPath(event) ?? "";
    return workflowAllowsPlanWrite(workflow) && isPlanFilePath(filePath, cwd)
      ? {
          action: "allow",
          reason: "Workflow: kontrollierter Plan-Schreibzugriff",
        }
      : {
          action: "block",
          reason:
            "Dieser Workflow blockiert Schreibzugriffe außerhalb des aktuellen Plans.",
        };
  }
  return {
    action: "block",
    reason: `Workflow ${workflow.state}: Tool "${event.toolName}" ist nicht freigegeben.`,
  };
}
