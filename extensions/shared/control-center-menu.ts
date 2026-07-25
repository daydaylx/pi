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
  | "diagnostics"
  | "thinking-view";

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
      id: "workflow",
      label: "Workflow",
      description: "Planungs- und Arbeitsmodus auswählen",
      icon: "◆",
      children: [
        { id: "mode-simple-plan", label: "Schnellplan", description: "Kleine Änderung planen; keine Umsetzung ohne /work", details: "Kompakter Plan für überschaubare Änderungen.", value: "simple_plan", current: state.mode === "simple_plan" },
        { id: "mode-detailed-plan", label: "Architekturplan", description: "Größere Änderung strukturiert vorbereiten", details: "Analysiert Kontext, Optionen und Risiken vor der Umsetzung.", value: "detailed_plan", current: state.mode === "detailed_plan" },
        { id: "mode-work", label: "Arbeitsmodus", description: "Bestehenden Plan oder freie Aufgabe bearbeiten", value: "work", current: state.mode === "work" },
        { id: "mode-decide", label: "Optionen klären", description: "Vor der Planung eine Entscheidung vorbereiten", value: "decide", current: state.deciding },
      ],
    },
    {
      id: "model",
      label: "Modell",
      description: "Modellrolle und Denkmodus",
      icon: "◈",
      children: [
        { id: "control-model-roles", label: "Modelle & Scopes", description: "Globale Modelle oder native Scoped Models für diese Sitzung wählen", value: "model-roles" },
        { id: "control-thinking", label: `Denken: ${state.thinkingLabel}`, description: "Denkmodus für diese Sitzung", badge: state.thinkingLabel, value: "thinking" },
      ],
    },
    {
      id: "security",
      label: "Sicherheit",
      description: "Berechtigungen und Risiko",
      icon: "◉",
      children: [{ id: "control-permissions", label: `Berechtigungen: ${state.permissionLabel}`, description: "Zugriffsstufe wählen", badge: state.permissionLabel, value: "permissions" }],
    },
    {
      id: "tools",
      label: "Werkzeuge",
      description: "Lokale Diagnosewerkzeuge",
      icon: "◇",
      children: [{ id: "control-diagnostics", label: "LSP-Diagnose", description: "LSP-Status anzeigen oder eine Datei prüfen", value: "diagnostics" }],
    },
    {
      id: "display",
      label: "Darstellung",
      description: "Thinking-Anzeige im Terminal",
      icon: "◌",
      children: [{ id: "control-thinking-view", label: "Thinking-Anzeige", description: "Kompakt, Fokus oder aus", value: "thinking-view" }],
    },
  ];
}
