import type { MenuEntry } from "./menu-ui.ts";
import type { WorkflowMode } from "./workflow-mode.ts";

export type WorkflowAction = WorkflowMode;

/**
 * The three workflow modes as menu data, and nothing else. Shift+Tab renders
 * them through Pi's native selector — deliberately, so the fastest switch in
 * the UI never takes keyboard focus away into an overlay.
 */
export function buildWorkflowEntries(
  activeMode: WorkflowMode,
): readonly MenuEntry<WorkflowAction>[] {
  return [
    {
      id: "workflow-work",
      label: "Work",
      description: "Normale Projektarbeit ohne Planpflicht",
      current: activeMode === "work",
      value: "work",
    },
    {
      id: "workflow-simple-plan",
      label: "Schnellplan",
      description: "Einen einfachen Markdown-Plan erstellen oder ersetzen",
      current: activeMode === "simple_plan",
      value: "simple_plan",
    },
    {
      id: "workflow-detailed-plan",
      label: "Architekturplan",
      description: "Einen detaillierten Markdown-Plan erstellen oder ersetzen",
      current: activeMode === "detailed_plan",
      value: "detailed_plan",
    },
  ];
}
