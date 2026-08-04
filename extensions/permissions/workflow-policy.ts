import type { ToolCallEvent } from "@earendil-works/pi-coding-agent";
import { relative, resolve, sep } from "node:path";
import { isSensitiveReference, isPlanSafeCommand, resolvePathScope } from "../shared/permission-policy.ts";
import type { WorkflowCapabilitySnapshot } from "../shared/workflow-capabilities.ts";
import { isPlanningMode } from "../shared/workflow-mode.ts";
import { isPlanFilePath } from "../plan-mode/plan-file.ts";
import { toolPath } from "./tool-event.ts";

export type WorkflowActionClass = "safe-read" | "known-mutation" | "unknown-risk" | "hard-block";

export interface WorkflowAssessment {
  classification: WorkflowActionClass;
  reason: string;
  impacts: string[];
}

export const LOCAL_LSP_TOOLS = new Set([
  "lsp_diagnostics", "lsp_definition", "lsp_references", "lsp_hover", "lsp_workspace_symbols",
]);

const READ_TOOLS = new Set(["read", "grep", "find", "ls", "ask_user", "wait"]);
const WRITE_TOOLS = new Set(["write", "edit"]);

function inside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`));
}

function hardBash(command: string): string | undefined {
  if (isSensitiveReference(command)) return "Harte Secret- oder Credential-Grenze";
  if (/\b(?:sudo|su)\b/i.test(command)) return "Harte Grenze: erhöhte Rechte";
  if (/\b(?:apt|apt-get|dnf|yum|pacman|zypper|brew)\s+(?:install|remove|purge|update|upgrade)\b/i.test(command)) return "Harte Systemgrenze: System-Paketoperation";
  if (/\b(?:curl|wget)\b[^|;&]*\|\s*(?:sudo\s+)?(?:sh|bash|zsh|dash|ksh)\b/i.test(command)) return "Harte Grenze: Download-to-shell";
  if (/\brm\b[^;&|]*(?:^|\s)["']?\/(?:[/.])*["']?(?=\s|$)/i.test(command)) return "Harte Grenze: Löschen des Root-Dateisystems";
  return undefined;
}

export function assessBash(command: string, cwd: string): WorkflowAssessment {
  const hard = hardBash(command);
  if (hard) return { classification: "hard-block", reason: hard, impacts: [hard] };
  if (isPlanSafeCommand(command, cwd)) {
    return { classification: "safe-read", reason: "Nachweislich lesende Shell-Analyse", impacts: [] };
  }
  if (/\b(?:mkdir|touch|rm|cp|mv|tee|truncate|npm\s+(?:install|uninstall|update|ci)|pnpm\s+(?:add|remove|install|update)|yarn\s+(?:add|remove|install)|pip\s+install)\b|(?:^|[^<])>(?!>)/i.test(command)) {
    return { classification: "known-mutation", reason: "Bekannte verändernde Shell-Aktion", impacts: ["Dateien oder Abhängigkeiten können verändert werden"] };
  }
  return { classification: "unknown-risk", reason: "Wirkung des Tool-Aufrufs konnte nicht sicher bestimmt werden", impacts: ["Shell-Ausführung oder externe Wirkung möglich"] };
}

export function assessWorkflowTool(event: ToolCallEvent, cwd: string): WorkflowAssessment {
  if (event.toolName === "bash") return assessBash(String((event.input as Record<string, unknown>).command ?? ""), cwd);
  const path = toolPath(event);
  if (path) {
    const scope = resolvePathScope(path, cwd);
    if (isSensitiveReference(path) || scope.symlinkEscape || !inside(resolve(cwd), scope.absolutePath)) {
      return { classification: "hard-block", reason: "Harte Projekt-, Symlink- oder Secret-Grenze", impacts: ["Zugriff ist nicht sicher begrenzbar"] };
    }
  }
  if (READ_TOOLS.has(event.toolName) || LOCAL_LSP_TOOLS.has(event.toolName)) {
    return { classification: "safe-read", reason: "Lesende Analyse", impacts: [] };
  }
  if (WRITE_TOOLS.has(event.toolName)) {
    return { classification: "known-mutation", reason: "Datei kann verändert werden", impacts: ["Projektdatei kann verändert werden"] };
  }
  return { classification: "unknown-risk", reason: "Unbekanntes Tool oder unklare Wirkung", impacts: ["Wirkung konnte nicht sicher bestimmt werden"] };
}

export function automaticallyAllowedInPlanMode(
  workflow: WorkflowCapabilitySnapshot,
  event: ToolCallEvent,
  cwd: string,
): boolean {
  return isPlanningMode(workflow.mode) &&
    WRITE_TOOLS.has(event.toolName) &&
    isPlanFilePath(toolPath(event), cwd);
}
