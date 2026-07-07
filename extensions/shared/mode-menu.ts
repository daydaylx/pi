import type { MenuEntry } from "./menu-ui.ts";
import type { WorkflowMode } from "./workflow-status.ts";

/**
 * `"decide"` startet den Decision-Intake (transiente Phase, siehe
 * plan-mode/README.md) statt einen persistenten WorkflowMode zu setzen.
 * `WorkflowMode` selbst bleibt unverändert auf simple_plan/detailed_plan/work
 * beschränkt — der Aufrufer in actions.ts muss "decide" vor dem Emit von
 * WORKFLOW_MODE_REQUEST_EVENT herausfiltern.
 */
export type ModeMenuAction = WorkflowMode | "decide";

export function buildModeMenu(mode: WorkflowMode): MenuEntry<ModeMenuAction>[] {
  return [
    {
      id: "mode-simple-plan",
      label: "Schnellplan",
      description:
        "Kompakter Planmodus (simple_plan) mit kurzen Rückfragen und klaren nächsten Schritten",
      value: "simple_plan",
      current: mode === "simple_plan",
    },
    {
      id: "mode-detailed-plan",
      label: "Architekturplan",
      description:
        "Detaillierte Analyse (detailed_plan) von Kontext, Risiken, Optionen und Umsetzung",
      value: "detailed_plan",
      current: mode === "detailed_plan",
    },
    {
      id: "mode-work",
      label: "Work-Modus",
      description:
        "Normaler Arbeitsmodus; eine vorhandene Plan-Datei wird nicht automatisch ausgeführt",
      value: "work",
      current: mode === "work",
    },
    {
      id: "mode-decide",
      label: "Optionen klären",
      description:
        "Interaktiver Decision-Intake (z. B. für UI-Entscheidungen) vor der Planung → Decision Brief",
      section: "Klärung",
      value: "decide",
    },
  ];
}
