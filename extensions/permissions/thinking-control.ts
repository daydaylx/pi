/**
 * Thinking depth control: manual level selection only.
 */
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { runMenu } from "../shared/menu-ui.ts";
import {
  buildThinkingMenu,
  isSelectableThinkingLevel,
  thinkingLabel,
  type SelectableThinkingLevel,
} from "../shared/thinking-menu.ts";

export interface ThinkingControl {
  /** The fields this control contributes to the shared persisted record. */
  fields(): {
    thinkingMode: "manual";
    manualThinkingLevel: SelectableThinkingLevel;
  };
  restore(data?: { manualThinkingLevel?: unknown }): void;
  applySelection(
    selection: SelectableThinkingLevel,
    ctx: ExtensionContext,
    isCurrentEpoch: () => boolean,
  ): void;
  openMenu(ctx: ExtensionContext, isCurrentEpoch: () => boolean): Promise<void>;
  onPersist: () => void;
}

export function createThinkingControl(pi: ExtensionAPI): ThinkingControl {
  let manualThinkingLevel: SelectableThinkingLevel = "medium";
  let pendingRestoreLevel: SelectableThinkingLevel | undefined;

  const control: ThinkingControl = {
    onPersist: () => {},

    fields: () => ({ thinkingMode: "manual", manualThinkingLevel }),

    restore(data) {
      // A record written before the auto mode was removed can still carry
      // `"auto"` here, which is not a thinking level. Anything unknown falls
      // back to the runtime's current default (settings.json's
      // defaultThinkingLevel) — read here, at session_start, because this is
      // the first point where the extension runtime is initialized. Reading
      // it eagerly at extension-load time throws.
      if (isSelectableThinkingLevel(data?.manualThinkingLevel)) {
        manualThinkingLevel = data.manualThinkingLevel;
      } else {
        const runtimeCurrent = pi.getThinkingLevel();
        manualThinkingLevel = isSelectableThinkingLevel(runtimeCurrent)
          ? runtimeCurrent
          : "medium";
      }
      pendingRestoreLevel = manualThinkingLevel;
      pi.setThinkingLevel(manualThinkingLevel);
      if (pi.getThinkingLevel() === manualThinkingLevel) {
        pendingRestoreLevel = undefined;
      }
    },

    applySelection(level, ctx, isCurrentEpoch) {
      if (!isCurrentEpoch()) return;
      manualThinkingLevel = level;
      pi.setThinkingLevel(level);
      ctx.ui.notify(`Thinking: ${thinkingLabel(level)}.`, "info");
    },

    async openMenu(ctx, isCurrentEpoch) {
      // One flat list of the real levels — the shared menu shell, the same one
      // the Command Center uses. A single-page tab dialog was chrome around
      // nothing.
      const selectedLevel = await runMenu<SelectableThinkingLevel>(
        ctx,
        "Thinking",
        buildThinkingMenu(
          pi.getThinkingLevel(),
          (level) =>
            ctx.model
              ? getSupportedThinkingLevels(ctx.model).includes(level)
              : true,
        ),
        {
          nonInteractiveHint: "Die Denktiefe benötigt den TUI-Modus.",
          headerShortcut: "Super+D",
        },
      );
      if (selectedLevel)
        control.applySelection(selectedLevel, ctx, isCurrentEpoch);
    },
  };

  // Pi owns the built-in /thinking command. Mirror its effective selection so
  // the extension's permission/thinking record remains persistent without
  // registering a conflicting duplicate command.
  pi.on("thinking_level_select", (event) => {
    if (!isSelectableThinkingLevel(event.level)) return;
    manualThinkingLevel = event.level;
    if (pendingRestoreLevel === event.level) {
      pendingRestoreLevel = undefined;
      return;
    }
    pendingRestoreLevel = undefined;
    control.onPersist();
  });

  return control;
}
