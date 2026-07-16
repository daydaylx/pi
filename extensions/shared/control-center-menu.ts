import type { MenuEntry } from "./menu-ui.ts";

export type WorkflowControlCenterAction =
  | "simple_plan"
  | "detailed_plan"
  | "work"
  | "decide";

export type ControlCenterAction =
  | WorkflowControlCenterAction
  | "model-roles"
  | "thinking"
  | "permissions"
  | "diagnostics";

export interface ControlCenterMenuState {
  mode: string;
  deciding: boolean;
  permissionLabel: string;
  thinkingLabel: string;
}

export function buildControlCenterMenu(
  state: ControlCenterMenuState,
): MenuEntry<ControlCenterAction>[] {
  return [
    {
      id: "mode-simple-plan",
      label: "Schnellplan",
      description: "Kleine Änderung planen. Schnell · wenig Risiko · keine Umsetzung ohne /work",
      value: "simple_plan",
      current: state.mode === "simple_plan",
    },
    {
      id: "mode-detailed-plan",
      label: "Architekturplan",
      description: "Größere Änderung sauber planen. Tief · strukturiert · sicher",
      value: "detailed_plan",
      current: state.mode === "detailed_plan",
    },
    {
      id: "mode-work",
      label: "Work-Modus",
      description: "Bestehenden Plan oder freie Aufgabe bearbeiten. Kontrolliert · explizit · nur mit aktuellen Permissions",
      value: "work",
      current: state.mode === "work",
    },
    {
      id: "mode-decide",
      label: "Optionen klären",
      description: "Vorentscheidung klären. 2–4 Optionen · Empfehlung · Decision Brief vor dem Plan",
      value: "decide",
      current: state.deciding,
    },
    {
      id: "control-model-roles",
      section: "Modellrollen",
      label: "Modellrolle wechseln",
      description: "Fast, Primary oder Deep für diese Pi-Session wählen",
      value: "model-roles",
    },
    {
      id: "control-thinking",
      section: "Thinking",
      label: `Thinking: ${state.thinkingLabel}`,
      description: "Auto folgt dem Workflow-Default; Manuell bleibt beim Workflowwechsel erhalten",
      value: "thinking",
    },
    {
      id: "control-permissions",
      section: "Berechtigungen",
      label: `Berechtigungen: ${state.permissionLabel}`,
      description: "Zugriffsstufe wählen; die bestehende Policy bleibt aktiv",
      value: "permissions",
    },
    {
      id: "control-diagnostics",
      section: "LSP",
      label: "LSP-Diagnose",
      description: "LSP-Status anzeigen und genau eine Workspace-Datei prüfen",
      value: "diagnostics",
    },
  ];
}

export type ModelRole = "fast" | "primary" | "deep";

export interface ModelRoleMenuState {
  models: Record<ModelRole, string>;
  activeRole?: ModelRole;
}

const ROLE_LABEL: Record<ModelRole, string> = {
  fast: "Fast",
  primary: "Primary",
  deep: "Deep",
};

export function buildModelRoleMenu(
  state: ModelRoleMenuState,
): MenuEntry<ModelRole>[] {
  return (["fast", "primary", "deep"] as const).map((role) => ({
    id: `model-role-${role}`,
    label: ROLE_LABEL[role],
    description: state.models[role],
    value: role,
    current: state.activeRole === role,
  }));
}
