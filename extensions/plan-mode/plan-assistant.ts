/**
 * State-aware actions for the /plan assistant.
 *
 * This is deliberately only a menu description.  It reads the canonical v3
 * load result and delegates all mutations to the existing controllers, so the
 * assistant cannot become a second workflow state machine.
 */
import type { TabbedOverlayTab } from "../shared/tabbed-overlay.ts";
import type { WorkflowStateLoadResult } from "./store/index.ts";

export type PlanAssistantAction =
  | "new-simple"
  | "new-detailed"
  | "revise"
  | "review"
  | "resume"
  | "show-steps"
  | "verify"
  | "finish"
  | "discard"
  | "migrate";

const action = (
  id: string,
  label: string,
  description: string,
  value: PlanAssistantAction,
  tone?: "danger" | "warning",
) => ({ id, label, description, value, ...(tone ? { tone } : {}) });

/** Build the single v3-native Plan-Assistent tab from persisted workflow state. */
export function buildPlanAssistantTab(
  loaded: WorkflowStateLoadResult,
): TabbedOverlayTab<PlanAssistantAction> {
  if (loaded.migrationRequired) {
    return {
      id: "plan-assistant",
      label: "Plan",
      badge: "MIGRATION",
      entries: [
        action(
          "plan-migrate",
          "Legacy-Plan migrieren",
          "v1/v2 nach bestätigtem Backup ausdrücklich nach v3 migrieren",
          "migrate",
          "warning",
        ),
      ],
    };
  }

  if (!loaded.snapshot || !loaded.state) {
    return {
      id: "plan-assistant",
      label: "Plan",
      entries: [
        action(
          "plan-new-simple",
          "Neuen Schnellplan starten",
          "Kurzer Plan für eine überschaubare Änderung",
          "new-simple",
        ),
        action(
          "plan-new-detailed",
          "Neuen Architekturplan starten",
          "Bewertete Optionen und begründete Entscheidung",
          "new-detailed",
        ),
      ],
    };
  }

  const common = [
    action(
      "plan-show-steps",
      "Schritte anzeigen",
      "Stabile Planschritte und ihr Sidecar-Status",
      "show-steps",
    ),
    action(
      "plan-verify",
      "Prüfungen vorab anzeigen",
      "Read-only-Diagnose mit derselben Klassifikation wie Completion",
      "verify",
    ),
    action(
      "plan-discard",
      "Plan verwerfen",
      "Plan, Sidecar und unarchivierten Completion-Bericht nach Bestätigung entfernen",
      "discard",
      "danger",
    ),
  ];

  switch (loaded.state.status) {
    case "planning":
      return {
        id: "plan-assistant",
        label: "Plan",
        badge: "PLANUNG",
        entries: [
          action(
            "plan-revise",
            "Plan überarbeiten",
            "Eine neue Planrevision erstellen; vorhandener Fortschritt wird bestätigt zurückgesetzt",
            "revise",
          ),
          action(
            "plan-review",
            "Plan reviewen",
            "Scope, Risiken und Abschlusskriterien vertieft prüfen",
            "review",
          ),
          action(
            "plan-resume",
            "Umsetzung starten",
            "Den bestätigten Plan ausdrücklich mit /work ausführen",
            "resume",
          ),
          ...common,
        ],
      };
    case "working":
    case "paused":
    case "blocked":
      return {
        id: "plan-assistant",
        label: "Plan",
        badge: loaded.state.status === "blocked" ? "BLOCKIERT" : "FORTSETZEN",
        entries: [
          action(
            "plan-resume",
            "Ausführung fortsetzen",
            "Gespeicherten Fortschritt ausdrücklich über /work fortsetzen",
            "resume",
          ),
          ...common,
        ],
      };
    case "reviewing":
      return {
        id: "plan-assistant",
        label: "Plan",
        badge: "ABSCHLUSS",
        entries: [
          action(
            "plan-finish",
            "Completion starten",
            "Die einzige verbindliche Completion-Pipeline ausführen",
            "finish",
          ),
          ...common,
        ],
      };
    case "done":
      return {
        id: "plan-assistant",
        label: "Plan",
        badge: "FERTIG",
        entries: common,
      };
    case "idle":
      return {
        id: "plan-assistant",
        label: "Plan",
        entries: common,
      };
  }
}
