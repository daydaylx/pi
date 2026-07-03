import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  Key,
  matchesKey,
  truncateToWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { extractTodoItems, readPlanFile } from "./plan-mode/utils.ts";
import {
  WORKFLOW_MODE_LABEL,
  WORKFLOW_STATUS_EVENT,
  type PermissionLevel,
  type RuntimeMode,
  type WorkflowPhase,
  type WorkflowStatusEvent,
  type WriteOverride,
} from "./shared/workflow-status.ts";
import {
  buildActionMenu,
  putCommandInEditor,
  selectActionWithFallback,
  type ActionMenuItem,
  type ActionMenuState,
} from "./shared/action-menu.ts";

export {
  buildActionMenu,
  putCommandInEditor,
  selectActionWithFallback,
  type ActionMenuItem,
  type ActionMenuState,
} from "./shared/action-menu.ts";

function isSelectable(actions: ActionMenuItem[], index: number): boolean {
  return actions[index]?.kind !== "info";
}

async function selectWithCustomUi(
  state: ActionMenuState,
  actions: ActionMenuItem[],
  ctx: ExtensionContext,
): Promise<ActionMenuItem | undefined> {
  return ctx.ui.custom<ActionMenuItem | undefined>(
    (tui, theme, _keybindings, done) => {
      let selectedIndex = actions.findIndex((_, index) =>
        isSelectable(actions, index),
      );

      const refresh = () => tui.requestRender();
      const move = (delta: number) => {
        if (selectedIndex < 0) return;
        let next = selectedIndex;
        for (let step = 0; step < actions.length; step += 1) {
          next = (next + delta + actions.length) % actions.length;
          if (isSelectable(actions, next)) break;
        }
        selectedIndex = next;
        refresh();
      };

      return {
        render(width: number): string[] {
          const usableWidth = Math.max(20, width);
          const border = theme.fg("borderMuted", "─".repeat(usableWidth));
          const todoSummary =
            state.totalTodos > 0
              ? ` • Todos ${state.completedTodos}/${state.totalTodos}`
              : "";
          const summary =
            `Mode ${state.mode.toUpperCase()} • ` +
            `${WORKFLOW_MODE_LABEL[state.phase]}${todoSummary}`;
          const lines = [
            border,
            theme.fg("accent", theme.bold(" Menü")),
            theme.fg("muted", ` ${summary}`),
          ];

          let lastSection: string | undefined;
          for (let index = 0; index < actions.length; index += 1) {
            const action = actions[index];
            if (action.section !== lastSection) {
              lines.push("");
              lines.push(
                theme.fg("dim", theme.bold(` ${action.section.toUpperCase()}`)),
              );
              lastSection = action.section;
            }

            const selected = index === selectedIndex;
            const isInfo = action.kind === "info";
            const marker = action.current ? "●" : " ";
            const prefix = selected ? theme.fg("accent", " › ") : "   ";
            const labelText = `${marker} ${action.label}`;
            const label = selected
              ? theme.fg("accent", theme.bold(labelText))
              : isInfo
                ? theme.fg("muted", labelText)
                : theme.fg("text", labelText);
            const commandSuffix = action.command
              ? theme.fg("dim", `  ${action.command}`)
              : "";
            lines.push(
              truncateToWidth(`${prefix}${label}${commandSuffix}`, usableWidth),
            );
          }

          const active =
            selectedIndex >= 0 ? actions[selectedIndex] : undefined;
          lines.push("");
          if (active) {
            lines.push(
              ...wrapTextWithAnsi(
                theme.fg("muted", ` ${active.description}`),
                usableWidth,
              ),
            );
          }
          lines.push(
            theme.fg(
              "dim",
              " ↑↓ auswählen • Enter vorbereiten • Esc schließen",
            ),
          );
          lines.push(border);
          return lines;
        },
        invalidate() {},
        handleInput(data: string): void {
          if (matchesKey(data, Key.up)) {
            move(-1);
          } else if (matchesKey(data, Key.down)) {
            move(1);
          } else if (matchesKey(data, Key.enter)) {
            if (selectedIndex >= 0) done(actions[selectedIndex]);
          } else if (
            matchesKey(data, Key.escape) ||
            matchesKey(data, Key.ctrl("c"))
          ) {
            done(undefined);
          }
        },
      };
    },
    {
      overlay: true,
      overlayOptions: {
        anchor: "center",
        width: "72%",
        maxHeight: "80%",
        margin: 2,
      },
    },
  );
}

async function selectWithFallback(
  state: ActionMenuState,
  actions: ActionMenuItem[],
  ctx: ExtensionContext,
): Promise<ActionMenuItem | undefined> {
  return selectActionWithFallback(
    actions,
    () => selectWithCustomUi(state, actions, ctx),
    (labels) => ctx.ui.select("Nächste Aktion wählen", labels),
  );
}

export default function actionsExtension(pi: ExtensionAPI): void {
  let mode: RuntimeMode = "work";
  let phase: WorkflowPhase = "idle";
  let permissionLevel: PermissionLevel = "read-write";
  let writeOverride: WriteOverride = "inherit";

  pi.events.on(WORKFLOW_STATUS_EVENT, (event: WorkflowStatusEvent) => {
    if (event.source === "permission") {
      mode = event.mode;
      permissionLevel = event.permissionLevel;
      writeOverride = event.writeOverride;
    } else {
      phase = event.phase;
    }
  });

  async function openCentralMenu(ctx: ExtensionContext): Promise<void> {
    if (ctx.mode !== "tui" || !ctx.hasUI) {
      ctx.ui.notify("Das Menü benötigt den TUI-Modus.", "error");
      return;
    }
    if (!ctx.isIdle()) {
      ctx.ui.notify("Das Menü ist nur im Leerlauf verfügbar.", "info");
      return;
    }

    let planContent: string | undefined;
    try {
      planContent = readPlanFile(ctx.cwd);
    } catch {
      planContent = undefined;
    }
    const todos = planContent ? extractTodoItems(planContent) : [];
    const modelLabel = ctx.model
      ? `${ctx.model.id} (${ctx.model.provider})`
      : "kein Modell aktiv";

    const state: ActionMenuState = {
      mode,
      phase,
      planExists: planContent !== undefined,
      completedTodos: todos.filter((todo) => todo.completed).length,
      totalTodos: todos.length,
      availableCommands: new Set(
        pi.getCommands().map((command) => command.name),
      ),
      thinkingLevel: pi.getThinkingLevel(),
      permissionLevel,
      writeOverride,
      modelLabel,
    };
    const actions = buildActionMenu(state);
    const selected = await selectWithFallback(state, actions, ctx);
    if (selected?.command) await putCommandInEditor(selected.command, ctx);
  }

  pi.registerCommand("actions", {
    description: "Zentrales Menü öffnen (Modus/Permissions/Thinking/Modell)",
    handler: async (_args, ctx) => openCentralMenu(ctx),
  });

  pi.registerShortcut("shift+tab", {
    description: "Zentrales Menü öffnen (Modus/Permissions/Thinking/Modell)",
    handler: async (ctx) => openCentralMenu(ctx),
  });
}
