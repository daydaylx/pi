import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  PERMISSION_LEVEL_DESCRIPTION,
  PERMISSION_LEVEL_LABEL,
  type PermissionLevel,
  type RuntimeMode,
  type WorkflowPhase,
  type WriteOverride,
} from "./workflow-status.ts";

export interface ActionMenuItem {
  id: string;
  label: string;
  description: string;
  command: string;
  section: string;
  current?: boolean;
  // "info" rows are pure status display: not selectable, skipped by
  // keyboard navigation. Defaults to "command" when omitted.
  kind?: "command" | "info";
}

export interface ActionMenuState {
  mode: RuntimeMode;
  phase: WorkflowPhase;
  planExists: boolean;
  completedTodos: number;
  totalTodos: number;
  availableCommands: ReadonlySet<string>;
  thinkingLevel: string;
  permissionLevel: PermissionLevel;
  writeOverride: WriteOverride;
  modelLabel: string;
}

function hasCommand(state: ActionMenuState, name: string): boolean {
  return state.availableCommands.has(name);
}

const THINKING_LEVELS = ["low", "medium", "high", "xhigh"] as const;

const WRITE_OVERRIDE_ROWS: Array<{
  value: WriteOverride;
  label: string;
  arg: string;
}> = [
  {
    value: "inherit",
    label: "Schreiben erlauben (Modus-Standard)",
    arg: "allow",
  },
  { value: "block", label: "Schreiben blockieren", arg: "block" },
  {
    value: "plan-file-only",
    label: "Nur Plan-Datei schreiben erlauben",
    arg: "plan-only",
  },
];

function buildModeSection(state: ActionMenuState): ActionMenuItem[] {
  const isPlan = state.mode === "plan";
  return [
    {
      id: "mode-plan",
      section: "Modus",
      label: "Plan Mode",
      description: "Sichere Analyse; nur Lesen und Plan-Datei beschreibbar",
      command: "/plan",
      current: isPlan,
      kind: isPlan ? "info" : "command",
    },
    {
      id: "mode-work",
      section: "Modus",
      label: "Work Mode",
      description: state.planExists
        ? "Normaler Projektzugriff; aktueller Plan kann ausgeführt werden"
        : "Normaler Projektzugriff mit Rückfragen bei riskanten Aktionen",
      command: "/work",
      current: !isPlan,
      kind: !isPlan ? "info" : "command",
    },
  ];
}

function buildPermissionSection(state: ActionMenuState): ActionMenuItem[] {
  return (Object.keys(PERMISSION_LEVEL_LABEL) as PermissionLevel[]).map(
    (level) => ({
      id: `permission-${level}`,
      section: "Permissions",
      label: PERMISSION_LEVEL_LABEL[level],
      description: PERMISSION_LEVEL_DESCRIPTION[level],
      command: `/permission ${level}`,
      current: state.permissionLevel === level,
    }),
  );
}

function buildWriteRightsSection(state: ActionMenuState): ActionMenuItem[] {
  const items: ActionMenuItem[] = WRITE_OVERRIDE_ROWS.map((row) => ({
    id: `write-${row.value}`,
    section: "Schreibrechte",
    label: row.label,
    description:
      state.mode === "plan"
        ? "Wirkt erst außerhalb von Plan Mode (Plan Mode erzwingt ohnehin nur die Plan-Datei)"
        : "Überschreibt die Schreibregeln des aktuellen Modus",
    command: `/write ${row.arg}`,
    current: state.writeOverride === row.value,
  }));

  items.push(
    {
      id: "write-sudo-info",
      section: "Schreibrechte",
      label: "sudo: wird bestätigt",
      description:
        state.permissionLevel === "yolo"
          ? "Ausnahme: in YOLO wird generisches sudo automatisch erlaubt"
          : "In jeder anderen Stufe wird sudo bestätigt",
      command: "",
      kind: "info",
    },
    {
      id: "write-delete-info",
      section: "Schreibrechte",
      label: "Löschungen: werden bestätigt",
      description:
        state.permissionLevel === "yolo"
          ? "Ausnahme: in YOLO wird rm/rmdir/unlink automatisch erlaubt"
          : "In jeder anderen Stufe werden Löschungen bestätigt",
      command: "",
      kind: "info",
    },
  );
  return items;
}

function buildThinkingSection(state: ActionMenuState): ActionMenuItem[] {
  if (!hasCommand(state, "thinking")) return [];
  return THINKING_LEVELS.map((level) => ({
    id: `thinking-${level}`,
    section: "Thinking",
    label: level,
    description: `Thinking-Level auf ${level} setzen`,
    command: `/thinking ${level}`,
    current: state.thinkingLevel === level,
  }));
}

function buildModelSection(state: ActionMenuState): ActionMenuItem[] {
  return [
    {
      id: "model-current",
      section: "Modell",
      label: state.modelLabel,
      description: "Aktuelles Modell",
      command: "",
      kind: "info",
      current: true,
    },
    {
      id: "model-switch",
      section: "Modell",
      label: "Modell wechseln…",
      description: "Native Modellauswahl öffnen",
      command: "/model",
    },
  ];
}

function buildWorkflowSection(state: ActionMenuState): ActionMenuItem[] {
  const actions: ActionMenuItem[] = [];

  if (state.planExists && hasCommand(state, "preview")) {
    actions.push({
      id: "preview-plan",
      section: "Workflow",
      label: "Plan als Markdown anzeigen",
      description: "Bestehende Plan-Datei nur in der Vorschau öffnen",
      command: "/preview .agent/plans/current-plan.md",
    });
  }

  if (state.planExists && hasCommand(state, "review-plan")) {
    actions.push({
      id: "review-plan",
      section: "Workflow",
      label: "Plan prüfen",
      description: "Optionalen Plan-Review im geschützten Plan Mode starten",
      command: "/review-plan",
    });
  }

  if (state.totalTodos > 0 && hasCommand(state, "plan-todos")) {
    actions.push({
      id: "plan-todos",
      section: "Workflow",
      label: `Todos anzeigen (${state.completedTodos}/${state.totalTodos})`,
      description: "Aktuellen Plan-Fortschritt anzeigen",
      command: "/plan-todos",
    });
  }

  if (state.planExists && hasCommand(state, "finish")) {
    actions.push({
      id: "finish",
      section: "Workflow",
      label: "Plan abschließen",
      description: "Plan nach Bestätigung archivieren",
      command: "/finish",
    });
  }

  if (hasCommand(state, "tools")) {
    actions.push({
      id: "tools",
      section: "Workflow",
      label: "Tools konfigurieren",
      description: "Aktive Agent-Tools auswählen",
      command: "/tools",
    });
  }

  if (hasCommand(state, "scroll")) {
    actions.push({
      id: "scroll",
      section: "Workflow",
      label: "Session-Historie durchsuchen",
      description: "Vorhandene Pi-Sessions mit Vorschau durchsuchen",
      command: "/scroll",
    });
  }

  if (hasCommand(state, "status")) {
    actions.push({
      id: "status",
      section: "Workflow",
      label: "Workflow-Status anzeigen",
      description: "Mode, Plan, Git und nächsten Schritt anzeigen",
      command: "/status",
    });
  }

  return actions;
}

export function buildActionMenu(state: ActionMenuState): ActionMenuItem[] {
  return [
    ...buildModeSection(state),
    ...buildPermissionSection(state),
    ...buildWriteRightsSection(state),
    ...buildThinkingSection(state),
    ...buildModelSection(state),
    ...buildWorkflowSection(state),
  ];
}

export async function putCommandInEditor(
  command: string,
  ctx: ExtensionContext,
): Promise<boolean> {
  const existing = ctx.ui.getEditorText().trim();
  if (existing && existing !== command) {
    const replace = await ctx.ui.confirm(
      "Editorinhalt ersetzen?",
      `Der aktuelle Entwurf wird durch ${command} ersetzt.`,
    );
    if (!replace) return false;
  }

  ctx.ui.setEditorText(command);
  ctx.ui.notify(`${command} bereit — Enter zum Ausführen.`, "info");
  return true;
}

export async function selectActionWithFallback(
  actions: ActionMenuItem[],
  customPicker: () => Promise<ActionMenuItem | undefined>,
  fallbackPicker: (labels: string[]) => Promise<string | undefined>,
): Promise<ActionMenuItem | undefined> {
  try {
    return await customPicker();
  } catch {
    const selectable = actions.filter((action) => action.kind !== "info");
    const labels = selectable.map(
      (action) => `${action.label} — ${action.command}`,
    );
    const choice = await fallbackPicker(labels);
    const index = choice ? labels.indexOf(choice) : -1;
    return index >= 0 ? selectable[index] : undefined;
  }
}
