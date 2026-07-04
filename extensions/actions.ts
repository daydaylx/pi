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
import {
  PERMISSION_REQUEST_EVENT,
  WORKFLOW_MODE_REQUEST_EVENT,
  WORKFLOW_STATUS_EVENT,
  type PermissionLevel,
  type PermissionRequest,
  type WorkflowMode,
  type WorkflowModeRequest,
  type WorkflowStatusEvent,
} from "./shared/workflow-status.ts";
import {
  buildActionMenu,
  initialActionIndex,
  moveActionIndex,
  selectActionWithFallback,
  type ActionMenuItem,
  type ActionMenuState,
} from "./shared/action-menu.ts";

export {
  buildActionMenu,
  initialActionIndex,
  moveActionIndex,
  selectActionWithFallback,
  type ActionMenuItem,
  type ActionMenuState,
} from "./shared/action-menu.ts";

async function selectWithCustomUi(
  state: ActionMenuState,
  actions: ActionMenuItem[],
  ctx: ExtensionContext,
): Promise<ActionMenuItem | undefined> {
  return ctx.ui.custom<ActionMenuItem | undefined>(
    (tui, theme, _keybindings, done) => {
      let selectedIndex = initialActionIndex(actions);

      const refresh = () => tui.requestRender();
      const move = (delta: number) => {
        if (selectedIndex < 0) return;
        selectedIndex = moveActionIndex(
          selectedIndex,
          delta,
          actions.length,
        );
        refresh();
      };

      return {
        render(width: number): string[] {
          const usableWidth = Math.max(20, width);
          const border = theme.fg("borderMuted", "─".repeat(usableWidth));
          const modeLabel = state.mode.replaceAll("_", " ").toUpperCase();
          const summary = `Mode ${modeLabel} • Permission ${state.permissionLevel}`;
          const lines = [
            border,
            theme.fg("accent", theme.bold(" Modus & Permissions")),
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
            const marker = action.current ? "●" : " ";
            const prefix = selected ? theme.fg("accent", " › ") : "   ";
            const labelText = `${marker} ${action.label}`;
            const label = selected
              ? theme.fg("accent", theme.bold(labelText))
              : theme.fg("text", labelText);
            lines.push(
              truncateToWidth(`${prefix}${label}`, usableWidth),
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
              " ↑↓ auswählen • Enter aktivieren • Esc schließen",
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
  let mode: WorkflowMode = "work";
  let permissionLevel: PermissionLevel = "read-write";

  pi.events.on(WORKFLOW_STATUS_EVENT, (event: WorkflowStatusEvent) => {
    if (event.source === "permission") {
      permissionLevel = event.permissionLevel;
    } else {
      mode = event.mode;
    }
  });

  async function openCentralMenu(ctx: ExtensionContext): Promise<void> {
    if (ctx.mode !== "tui" || !ctx.hasUI) {
      ctx.ui.notify("Das Menü benötigt den TUI-Modus.", "error");
      return;
    }

    const state: ActionMenuState = {
      mode,
      permissionLevel,
    };
    const actions = buildActionMenu(state);
    const selected = await selectWithFallback(state, actions, ctx);
    if (!selected) return;
    if (selected.target.type === "mode") {
      pi.events.emit(WORKFLOW_MODE_REQUEST_EVENT, {
        mode: selected.target.mode,
        ctx,
      } satisfies WorkflowModeRequest);
    } else {
      pi.events.emit(PERMISSION_REQUEST_EVENT, {
        level: selected.target.level,
        ctx,
      } satisfies PermissionRequest);
    }
  }

  pi.registerCommand("actions", {
    description: "Modus- und Permission-Menü öffnen",
    handler: async (_args, ctx) => openCentralMenu(ctx),
  });

  pi.registerShortcut("shift+tab", {
    description: "Modus- und Permission-Menü öffnen",
    handler: async (ctx) => openCentralMenu(ctx),
  });
}
