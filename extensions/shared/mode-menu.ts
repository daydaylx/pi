import type { MenuEntry } from "./menu-ui.ts";
import type { WorkflowMode } from "./workflow-status.ts";

/**
 * `"decide"` startet den Decision-Intake (transiente Phase, siehe
 * plan-mode/README.md) statt einen persistenten WorkflowMode zu setzen.
 * `WorkflowMode` selbst bleibt unverändert auf simple_plan/detailed_plan/work
 * beschränkt — der Aufrufer in actions.ts muss "decide" vor dem Emit von
 * WORKFLOW_MODE_REQUEST_EVENT herausfiltern.
 *
 * `deciding` markiert den Klär-Eintrag als aktiv, solange die transiente
 * `deciding`-Phase läuft (Status DECIDE) — analog zum `current`-Marker der
 * echten Modus-Einträge.
 */
export type ModeMenuAction = WorkflowMode | "decide" | "skill";

export function buildModeMenu(
  mode: WorkflowMode,
  deciding = false,
): MenuEntry<ModeMenuAction>[] {
  return [
    {
      id: "mode-simple-plan",
      label: "Schnellplan",
      description:
        "Kleine Änderung planen. Schnell · wenig Risiko · keine Umsetzung ohne /work",
      value: "simple_plan",
      current: mode === "simple_plan",
    },
    {
      id: "mode-detailed-plan",
      label: "Architekturplan",
      description:
        "Größere Änderung sauber planen. Tief · strukturiert · sicher",
      value: "detailed_plan",
      current: mode === "detailed_plan",
    },
    {
      id: "mode-work",
      label: "Work-Modus",
      description:
        "Bestehenden Plan oder freie Aufgabe bearbeiten. Kontrolliert · explizit · nur mit aktuellen Permissions",
      value: "work",
      current: mode === "work",
    },
    {
      id: "mode-decide",
      label: "Optionen klären",
      description:
        "Vorentscheidung klären. 2–4 Optionen · Empfehlung · Decision Brief vor dem Plan",
      section: "Klärung",
      value: "decide",
      current: deciding,
    },
    {
      id: "mode-skill",
      label: "Skill-Modus",
      description:
        "Geführte Skills: Repository analysieren, Git prüfen, Doku-Diff, Bug-Triage, Security-Audit u. a.",
      section: "Skills",
      value: "skill",
    },
  ];
}
