/**
 * Thinking depth control: manual level selection only.
 */
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { runTabbedOverlay } from "../shared/tabbed-overlay.ts";
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

  const control: ThinkingControl = {
    onPersist: () => {},

    fields: () => ({ thinkingMode: "manual", manualThinkingLevel }),

    restore(data) {
      // A record written before the auto mode was removed can still carry
      // `"auto"` here, which is not a thinking level. Anything unknown falls
      // back to the default instead of being handed to the agent as-is.
      manualThinkingLevel = isSelectableThinkingLevel(data?.manualThinkingLevel)
        ? data.manualThinkingLevel
        : "medium";
      pi.setThinkingLevel(manualThinkingLevel);
    },

    applySelection(level, ctx, isCurrentEpoch) {
      if (!isCurrentEpoch()) return;
      manualThinkingLevel = level;
      pi.setThinkingLevel(level);
      control.onPersist();
      ctx.ui.notify(`Thinking: ${thinkingLabel(level)}.`, "info");
    },

    async openMenu(ctx, isCurrentEpoch) {
      const entries = buildThinkingMenu(pi.getThinkingLevel()).filter(
        (entry) =>
          entry.value !== undefined &&
          ctx.model?.thinkingLevelMap?.[entry.value] !== null,
      );
      const selected = await runTabbedOverlay<SelectableThinkingLevel>(
        ctx,
        "Thinking & Reasoning",
        [
          {
            id: "depth",
            label: "Denktiefe",
            entries,
          },
        ],
        { nonInteractiveHint: "Thinking & Reasoning benötigt den TUI-Modus." },
      );
      const selectedLevel = selected?.entry.value;
      if (selectedLevel)
        control.applySelection(selectedLevel, ctx, isCurrentEpoch);
    },
  };
  return control;
}
