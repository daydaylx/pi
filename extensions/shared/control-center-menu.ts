import type { MenuEntry } from "./menu-ui.ts";
import type { WorkflowMode } from "./workflow-mode.ts";

export type WorkflowAction = WorkflowMode | "plan-decide";

/**
 * The three workflow modes as menu data, plus — while a finished plan is
 * waiting — the decision that plan needs. Shift+Tab renders them through Pi's
 * native selector, deliberately, so the fastest switch in the UI never takes
 * keyboard focus away into an overlay.
 *
 * The decision entry is listed first and separately from "Work" because those
 * two used to be the same action: switching to work was what armed an
 * execution. Executing a plan and merely leaving plan mode are different
 * intentions and now have different entries.
 */
export function buildWorkflowEntries(
  activeMode: WorkflowMode,
  planReady = false,
): readonly MenuEntry<WorkflowAction>[] {
  const decision: MenuEntry<WorkflowAction>[] = planReady
    ? [
        {
          id: "workflow-plan-decide",
          label: "Fertiger Plan · entscheiden",
          description:
            "Plan ausführen, weiter planen oder ohne Ausführung nach Work",
          value: "plan-decide",
        },
      ]
    : [];
  return [
    ...decision,
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
