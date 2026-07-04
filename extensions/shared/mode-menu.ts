import type { MenuEntry } from "./menu-ui.ts";
import type { WorkflowMode } from "./workflow-status.ts";

export function buildModeMenu(mode: WorkflowMode): MenuEntry<WorkflowMode>[] {
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
  ];
}
