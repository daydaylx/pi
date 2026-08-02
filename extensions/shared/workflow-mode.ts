/** The complete planning workflow contract: one selected mode, nothing else. */
export type WorkflowMode = "work" | "simple_plan" | "detailed_plan";

export const WORKFLOW_MODES: readonly WorkflowMode[] = [
  "work",
  "simple_plan",
  "detailed_plan",
];

export function isPlanningMode(
  mode: WorkflowMode,
): mode is Exclude<WorkflowMode, "work"> {
  return mode === "simple_plan" || mode === "detailed_plan";
}

export function workflowModeLabel(mode: WorkflowMode): string {
  switch (mode) {
    case "work":
      return "Work";
    case "simple_plan":
      return "Schnellplan";
    case "detailed_plan":
      return "Architekturplan";
  }
}
