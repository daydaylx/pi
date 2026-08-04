import type { TabbedOverlayTab } from "./tabbed-overlay.ts";
import type { WorkflowMode } from "./workflow-mode.ts";

export type WorkflowAction = WorkflowMode;

export function buildWorkflowTab(
  activeMode: WorkflowMode,
): TabbedOverlayTab<WorkflowAction> {
  return {
    id: "workflow",
    label: "Workflow",
    entries: [
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
        description:
          "Einen detaillierten Markdown-Plan erstellen oder ersetzen",
        current: activeMode === "detailed_plan",
        value: "detailed_plan",
      },
    ],
  };
}
