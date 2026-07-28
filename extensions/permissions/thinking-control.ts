/**
 * Thinking depth: state, workflow default and the Thinking & Reasoning menu.
 *
 * Lives next to the permission modules because both are persisted in one
 * session record and both react to a workflow change — but the two are not the
 * same concern, and mixing them is what made the original file hard to read.
 *
 * Auto mode follows the workflow (an architecture plan raises the depth
 * immediately); a manually chosen level is a user decision and is never
 * overridden.
 */
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { CONTROL_CENTER_EVENTS } from "../shared/control-center-events.ts";
import { runTabbedOverlay } from "../shared/tabbed-overlay.ts";
import {
  buildThinkingMenu,
  thinkingLabel,
  type SelectableThinkingLevel,
} from "../shared/thinking-menu.ts";

export interface ThinkingControl {
  mode(): "auto" | "manual";
  manualLevel(): SelectableThinkingLevel | undefined;
  /** Fields this control contributes to the shared persisted record. */
  fields(): {
    thinkingMode: "auto" | "manual";
    manualThinkingLevel: SelectableThinkingLevel | undefined;
  };
  /** The level the active workflow asks for, or the current one. */
  workflowDefault(): ThinkingLevel;
  /** Apply the workflow default when the user has not chosen manually. */
  followWorkflow(): void;
  /** Restore from the persisted session record at session start. */
  restore(data?: {
    thinkingMode?: "auto" | "manual";
    manualThinkingLevel?: SelectableThinkingLevel;
  }): void;
  openMenu(ctx: ExtensionContext, isCurrentEpoch: () => boolean): Promise<void>;
  /** Wired by the extension entry so a change persists with the rest. */
  onPersist: () => void;
}

export function createThinkingControl(pi: ExtensionAPI): ThinkingControl {
  let thinkingMode: "auto" | "manual" = "auto";
  let manualThinkingLevel: SelectableThinkingLevel | undefined;

  const control: ThinkingControl = {
    onPersist: () => {},

    mode: () => thinkingMode,
    manualLevel: () => manualThinkingLevel,
    fields: () => ({ thinkingMode, manualThinkingLevel }),

    workflowDefault() {
      let level: ThinkingLevel | undefined;
      pi.events.emit(CONTROL_CENTER_EVENTS.workflowThinkingDefault, {
        respond: (value: { mode: string; defaultLevel: ThinkingLevel }) => {
          level = value.defaultLevel;
        },
      });
      return level ?? pi.getThinkingLevel();
    },

    followWorkflow() {
      if (thinkingMode === "auto")
        pi.setThinkingLevel(control.workflowDefault());
    },

    restore(data) {
      thinkingMode = data?.thinkingMode === "manual" ? "manual" : "auto";
      manualThinkingLevel = data?.manualThinkingLevel;
      if (thinkingMode === "manual" && manualThinkingLevel) {
        pi.setThinkingLevel(manualThinkingLevel);
      } else {
        thinkingMode = "auto";
        manualThinkingLevel = undefined;
        pi.setThinkingLevel(control.workflowDefault());
      }
    },

    async openMenu(ctx, isCurrentEpoch) {
      const entries = buildThinkingMenu(
        pi.getThinkingLevel(),
        thinkingMode,
      ).filter((entry) => {
        if (entry.value === "auto") return true;
        const value = entry.value;
        if (!value) return false;
        const level = value.slice("manual:".length) as SelectableThinkingLevel;
        return ctx.model?.thinkingLevelMap?.[level] !== null;
      });
      const selected = await runTabbedOverlay<
        "auto" | `manual:${SelectableThinkingLevel}` | "thinking-view"
      >(
        ctx,
        "Thinking & Reasoning",
        [
          {
            id: "depth",
            label: "Denktiefe",
            entries,
          },
          {
            id: "telemetry",
            label: "Anzeige & Telemetrie",
            entries: [
              {
                id: "thinking-view",
                label: "Status-Telemetrie",
                description:
                  "Ausgeblendet, kompakt oder mit Fokus; zeigt nie interne Modellgedanken",
                value: "thinking-view",
              },
            ],
          },
        ],
        { nonInteractiveHint: "Thinking & Reasoning benötigt den TUI-Modus." },
      );
      const value = selected?.entry.value;
      if (value === "thinking-view") {
        pi.events.emit(CONTROL_CENTER_EVENTS.openThinkingView, { ctx });
        return;
      }
      const selectedLevel = value;
      if (!selectedLevel || !isCurrentEpoch()) return;

      if (selectedLevel === "auto") {
        thinkingMode = "auto";
        manualThinkingLevel = undefined;
        const level = control.workflowDefault();
        pi.setThinkingLevel(level);
        control.onPersist();
        ctx.ui.notify(
          `Thinking: ${thinkingLabel(thinkingMode, level)}.`,
          "info",
        );
        return;
      }

      const level = selectedLevel.slice(
        "manual:".length,
      ) as SelectableThinkingLevel;
      thinkingMode = "manual";
      manualThinkingLevel = level;
      pi.setThinkingLevel(level);
      control.onPersist();
      ctx.ui.notify(`Thinking: ${thinkingLabel(thinkingMode, level)}.`, "info");
    },
  };
  return control;
}
