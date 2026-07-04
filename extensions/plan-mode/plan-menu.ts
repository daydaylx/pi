/**
 * Pure menu builders for the state-aware `/plan` assistant.
 *
 * These builders contain no filesystem or UI access — they only describe which
 * actions are offered for a given plan state. `routePlan()` in `index.ts` reads
 * the actual state, calls `buildPlanAssistantMenu(state)`, renders it via the
 * shared `runMenu(...)`, and dispatches the chosen `PlanAssistantAction`.
 *
 * Internal workflow values (`simple_plan` / `detailed_plan`) are unchanged; only
 * the user-facing labels were renamed to "Schnellplan" / "Architekturplan".
 */

import type { MenuEntry } from "../shared/menu-ui.ts";

export type PlanAssistantAction =
  | { kind: "new-plan"; mode: "simple_plan" | "detailed_plan" }
  | { kind: "continue-plan" }
  | { kind: "review" }
  | { kind: "execute" }
  | { kind: "show-todos" }
  | { kind: "archive" }
  | { kind: "cancel" };

/**
 * Decision returned by the overwrite guard when the user asks for a new plan
 * while an existing `current-plan.md` is present.
 */
export type OverwriteDecision = "archive-first" | "overwrite" | "cancel";

export interface PlanAssistantMenuState {
  planExists: boolean;
  /** True when the plan has at least one todo and all of them are completed. */
  allTodosComplete: boolean;
}

function newPlanEntries(): MenuEntry<PlanAssistantAction>[] {
  return [
    {
      id: "plan-new-quick",
      label: "Neuer Schnellplan",
      description:
        "Kompakter Plan für kleine bis mittlere Änderungen mit kurzen Rückfragen",
      section: "Neuer Plan",
      value: { kind: "new-plan", mode: "simple_plan" },
    },
    {
      id: "plan-new-architecture",
      label: "Neuer Architekturplan",
      description:
        "Ausführliche Analyse von Kontext, Risiken, Optionen und Umsetzung",
      section: "Neuer Plan",
      value: { kind: "new-plan", mode: "detailed_plan" },
    },
  ];
}

function cancelEntry(): MenuEntry<PlanAssistantAction> {
  return {
    id: "plan-cancel",
    label: "Abbrechen",
    description: "Plan-Assistent schließen, ohne etwas zu ändern",
    value: { kind: "cancel" },
  };
}

/**
 * Builds the action set offered by `/plan` depending on the current state.
 *
 * - No plan file: only "new plan" variants + cancel.
 * - Plan with open todos: continue/review/execute/show-todos/archive + new + cancel.
 * - Plan with all todos complete: archive/show-todos + new + cancel (no execute).
 *
 * Active review/execution is NOT a hard block — `routePlan()` emits a hint
 * notification before showing this menu and lets the user choose safely.
 */
export function buildPlanAssistantMenu(
  state: PlanAssistantMenuState,
): MenuEntry<PlanAssistantAction>[] {
  if (!state.planExists) {
    return [...newPlanEntries(), cancelEntry()];
  }

  const entries: MenuEntry<PlanAssistantAction>[] = [];

  if (!state.allTodosComplete) {
    entries.push({
      id: "plan-continue",
      label: "Aktuellen Plan weiterführen",
      description:
        "Plan-Modus aktivieren und den bestehenden Plan verfeinern oder ergänzen",
      section: "Aktueller Plan",
      value: { kind: "continue-plan" },
    });
    entries.push({
      id: "plan-review",
      label: "Aktuellen Plan reviewen",
      description: "Optionalen Deep-Review der Plan-Datei starten",
      section: "Aktueller Plan",
      value: { kind: "review" },
    });
    entries.push({
      id: "plan-execute",
      label: "Aktuellen Plan ausführen",
      description: "Plan-Datei über /work Schritt für Schritt umsetzen",
      section: "Aktueller Plan",
      value: { kind: "execute" },
    });
  }

  entries.push({
    id: "plan-show-todos",
    label: "Plan-Todos anzeigen",
    description: "Fortschritt aus der aktuellen Plan-Datei anzeigen",
    section: "Aktueller Plan",
    value: { kind: "show-todos" },
  });

  entries.push({
    id: "plan-archive",
    label: "Plan archivieren",
    description:
      "Aktuelle Plan-Datei sichern und aus current-plan.md entfernen (/finish)",
    section: "Aktueller Plan",
    value: { kind: "archive" },
  });

  entries.push(...newPlanEntries());
  entries.push(cancelEntry());
  return entries;
}

/**
 * Three-option guard shown before a new plan replaces an existing one.
 * `cancel` keeps the existing plan file untouched.
 */
export function buildOverwriteGuardMenu(): MenuEntry<OverwriteDecision>[] {
  return [
    {
      id: "overwrite-archive-first",
      label: "Bestehenden Plan archivieren & neu beginnen",
      description:
        "Aktuelle Plan-Datei ins Archiv sichern, danach den neuen Plan erstellen",
      value: "archive-first",
    },
    {
      id: "overwrite-now",
      label: "Bestehenden Plan überschreiben",
      description: "Aktuelle Plan-Datei ohne vorherige Sicherung ersetzen",
      value: "overwrite",
    },
    {
      id: "overwrite-cancel",
      label: "Abbrechen",
      description:
        "Keinen neuen Plan erstellen; die bestehende Datei bleibt erhalten",
      value: "cancel",
    },
  ];
}
