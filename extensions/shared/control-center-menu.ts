/** Pure workflow-switch data used by the canonical /workflow command. */
import type { TabbedOverlayTab } from "./tabbed-overlay.ts";
import type { WorkflowMode } from "./workflow-status.ts";

export type WorkflowAction =
  | "simple_plan"
  | "detailed_plan"
  | "plan_work"
  | "direct_task_start"
  | "direct_task_continue";

export interface ControlCenterState {
  /** Whether a plan exists that can be executed or resumed. */
  hasActivePlan: boolean;
  /** Whether a plan-less direct task is currently active. */
  hasActiveDirectTask: boolean;
  /** The mode currently in force, marked as the active entry. */
  activeMode?: WorkflowMode;
}

/** The workflow switch opened by /workflow and therefore by Shift+Tab. */
export function buildWorkflowTab(
  state: ControlCenterState,
): TabbedOverlayTab<WorkflowAction> {
  return {
    id: "workflow",
    label: "Workflow",
    entries: [
      {
        id: "workflow-simple-plan",
        label: "Schnellplan",
        description: "Kurzer Plan für eine überschaubare Änderung",
        disabled: state.hasActiveDirectTask,
        disabledReason: state.hasActiveDirectTask
          ? "Ein Direktauftrag ist aktiv. Schließe ihn zuerst mit /task-done ab."
          : undefined,
        current: state.activeMode === "simple_plan",
        value: "simple_plan",
      },
      {
        id: "workflow-detailed-plan",
        label: "Architekturplan",
        description:
          "Bewertete Optionen, begründete Empfehlung und Nutzerentscheidung",
        disabled: state.hasActiveDirectTask,
        disabledReason: state.hasActiveDirectTask
          ? "Ein Direktauftrag ist aktiv. Schließe ihn zuerst mit /task-done ab."
          : undefined,
        current: state.activeMode === "detailed_plan",
        value: "detailed_plan",
      },
      {
        id: "workflow-plan-work",
        label: "Plan ausführen / fortsetzen",
        description:
          "Bestätigten Plan sofort ausführen oder unterbrochene Ausführung fortsetzen",
        current: state.activeMode === "work" && state.hasActivePlan,
        value: "plan_work",
      },
      {
        id: "workflow-direct-task",
        label: state.hasActiveDirectTask
          ? "Direktauftrag fortsetzen"
          : "Direktauftrag starten",
        description: state.hasActiveDirectTask
          ? "Aktiven Direktauftrag weiterbearbeiten; Abschluss über /task-done"
          : "Kompakte Aufgabe ohne Plan mit Scope, Verifikation und Abschlusskriterien",
        disabled: state.hasActivePlan,
        disabledReason: state.hasActivePlan
          ? "Schließe den aktiven Plan ab oder verwirf ihn, bevor du einen Direktauftrag startest."
          : undefined,
        current: state.activeMode === "work" && state.hasActiveDirectTask,
        value: state.hasActiveDirectTask
          ? "direct_task_continue"
          : "direct_task_start",
      },
    ],
  };
}
