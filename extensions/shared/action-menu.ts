import {
  PERMISSION_LEVEL_DESCRIPTION,
  PERMISSION_LEVEL_LABEL,
  type PermissionLevel,
  type WorkflowMode,
} from "./workflow-status.ts";

export type ActionMenuTarget =
  | { type: "mode"; mode: WorkflowMode }
  | { type: "permission"; level: PermissionLevel };

export interface ActionMenuItem {
  id: string;
  label: string;
  description: string;
  section: "Plan-Modus" | "Work-Modus" | "Permissions";
  target: ActionMenuTarget;
  current?: boolean;
}

export interface ActionMenuState {
  mode: WorkflowMode;
  permissionLevel: PermissionLevel;
}

export function buildActionMenu(state: ActionMenuState): ActionMenuItem[] {
  const modeItems: ActionMenuItem[] = [
    {
      id: "mode-simple-plan",
      section: "Plan-Modus",
      label: "Einfacher Plan",
      description:
        "Kompakter Planmodus mit kurzen Rückfragen und klaren nächsten Schritten",
      target: { type: "mode", mode: "simple_plan" },
      current: state.mode === "simple_plan",
    },
    {
      id: "mode-detailed-plan",
      section: "Plan-Modus",
      label: "Ausführlicher Plan",
      description:
        "Detaillierte Analyse von Kontext, Risiken, Optionen und Umsetzung",
      target: { type: "mode", mode: "detailed_plan" },
      current: state.mode === "detailed_plan",
    },
    {
      id: "mode-work",
      section: "Work-Modus",
      label: "Work-Modus",
      description:
        "Normaler Arbeitsmodus; eine vorhandene Plan-Datei wird nicht automatisch ausgeführt",
      target: { type: "mode", mode: "work" },
      current: state.mode === "work",
    },
  ];

  const permissionItems = (
    Object.keys(PERMISSION_LEVEL_LABEL) as PermissionLevel[]
  ).map<ActionMenuItem>((level) => ({
    id: `permission-${level}`,
    section: "Permissions",
    label: PERMISSION_LEVEL_LABEL[level],
    description: PERMISSION_LEVEL_DESCRIPTION[level],
    target: { type: "permission", level },
    current: state.permissionLevel === level,
  }));

  return [...modeItems, ...permissionItems];
}

export function initialActionIndex(actions: ActionMenuItem[]): number {
  const currentMode = actions.findIndex(
    (action) => action.current && action.target.type === "mode",
  );
  return currentMode >= 0 ? currentMode : actions.length > 0 ? 0 : -1;
}

export function moveActionIndex(
  current: number,
  delta: number,
  actionCount: number,
): number {
  if (current < 0 || actionCount === 0) return -1;
  return (current + delta + actionCount) % actionCount;
}

export async function selectActionWithFallback(
  actions: ActionMenuItem[],
  customPicker: () => Promise<ActionMenuItem | undefined>,
  fallbackPicker: (labels: string[]) => Promise<string | undefined>,
): Promise<ActionMenuItem | undefined> {
  try {
    return await customPicker();
  } catch {
    const labels = actions.map(
      (action) => `${action.section}: ${action.label}`,
    );
    const choice = await fallbackPicker(labels);
    const index = choice ? labels.indexOf(choice) : -1;
    return index >= 0 ? actions[index] : undefined;
  }
}
