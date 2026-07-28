/**
 * The single Control Center definition.
 *
 * Pure data: this module decides what is offered, never how it is rendered or
 * what an action does. The two entry points differ in SCOPE, never in content:
 *
 *   Shift+Tab  the workflow switch — buildWorkflowTab() alone
 *   Super+Q    the full Control Center — buildControlCenterTabs(), which
 *              starts with that very same workflow tab
 *
 * Because both read from the same builders and both route through the same
 * action union, a workflow entry can never say one thing in one place and
 * something else in the other.
 */
import type { TabbedOverlayTab } from "./tabbed-overlay.ts";
import type { WorkflowMode } from "./workflow-status.ts";

export type ControlCenterAction =
  | "simple_plan"
  | "detailed_plan"
  | "plan_work"
  | "direct_task_start"
  | "direct_task_continue"
  | "models"
  | "routing_models"
  | "permissions"
  | "thinking"
  | "diagnostics";

export interface ControlCenterState {
  /** Whether a plan exists that can be executed or resumed. */
  hasActivePlan: boolean;
  /** Whether a plan-less direct task is currently active. */
  hasActiveDirectTask: boolean;
  /** The mode currently in force, marked as the active entry. */
  activeMode?: WorkflowMode;
}

/** The workflow switch: what Shift+Tab offers, and the first Control Center tab. */
export function buildWorkflowTab(
  state: ControlCenterState,
): TabbedOverlayTab<ControlCenterAction> {
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
        disabled: !state.hasActivePlan,
        disabledReason: !state.hasActivePlan
          ? "Erstelle und bestätige zuerst einen Plan."
          : undefined,
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

export function buildControlCenterTabs(
  state: ControlCenterState,
): TabbedOverlayTab<ControlCenterAction>[] {
  return [
    buildWorkflowTab(state),
    {
      id: "models",
      label: "Modell",
      entries: [
        {
          id: "model-selection",
          label: "Modelle",
          description: "Modell für diese Sitzung wählen",
          value: "models",
        },
        {
          id: "routing-model-selection",
          label: "Agenten-Modelle (Super+S)",
          description:
            "Modelle für Planner, Worker und Reviewer je Routingstufe anpassen",
          value: "routing_models",
        },
      ],
    },
    {
      id: "permissions",
      label: "Permissions",
      entries: [
        {
          id: "permission-level",
          label: "Zugriffsstufe",
          description:
            "Nur Lesen bis YOLO; YOLO umgeht Rückfragen, harte Grenzen bleiben aktiv",
          value: "permissions",
        },
        {
          id: "permission-rules",
          label: "Whitelist / Blacklist / Dateisystem",
          description: "Globale Policy-Datei",
          disabled: true,
          disabledReason:
            "Policy-Regeln bleiben bewusst außerhalb der Laufzeit-TUI.",
        },
      ],
    },
    {
      id: "thinking",
      label: "Thinking",
      entries: [
        {
          id: "thinking-depth",
          label: "Denktiefe",
          description: "Auto oder manuelle Denktiefe für diese Sitzung",
          value: "thinking",
        },
      ],
    },
    {
      id: "tools",
      label: "Tools",
      entries: [
        {
          id: "tool-diagnostics",
          label: "LSP-Diagnose",
          description: "Status und Diagnose einer Datei",
          value: "diagnostics",
        },
        {
          id: "tool-plugins",
          label: "Plugins & Erweiterungen",
          description: "Aktive Extensions werden beim Start geladen",
          disabled: true,
          disabledReason:
            "Dynamisches Laden/Entladen wird von Pi nicht unterstützt.",
        },
      ],
    },
    {
      id: "system",
      label: "System",
      entries: [
        {
          id: "system-theme",
          label: "Theme & Motion",
          description: "Aurora Night und Bewegungsmodus",
          disabled: true,
          disabledReason:
            "Die globale UI-Konfiguration bleibt außerhalb der Laufzeit-TUI.",
        },
        {
          id: "system-hotkeys",
          label: "Hotkeys",
          description: "CSI-u/Kitty Keyboard Protocol erforderlich",
          disabled: true,
          disabledReason:
            "Die Super-Shortcuts gelten im fokussierten Pi-Terminal.",
        },
      ],
    },
  ];
}
