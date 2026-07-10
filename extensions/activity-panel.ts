/**
 * Activity Panel Extension
 *
 * Rechtes, dauerhaftes Activity Panel für breite Terminals (>=
 * ACTIVITY_PANEL_MIN_WIDTH Spalten): zeigt Modus/Modell/Thinking, die
 * letzten Tool-Aufrufe (kompakt, aus shared/activity-state.ts gespeist) und
 * den Subagentenstatus. Bei schmalerem Terminal blendet sich das Panel
 * automatisch aus (overlayOptions.visible); tool-visuals.ts fällt dann
 * eigenständig auf kompakte Inline-Zeilen im Hauptbereich zurück.
 *
 * Die pi-tui-API kennt kein natives Spalten-/Split-Layout — Components
 * rendern grundsätzlich nur vertikal gestapelt. Das Panel wird deshalb als
 * nonCapturing Overlay (ctx.ui.custom) umgesetzt, das in die oberen rechten
 * Bildschirmzeilen hinein-komposittet wird, statt den Hauptbereich schmaler
 * zu reflowen. Es kann dadurch kurzzeitig über anderem Hauptinhalt an
 * derselben Bildschirmposition zu liegen kommen (siehe Plan-Risiken).
 * nonCapturing verhindert, dass das Panel den Editor-Fokus stiehlt.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  createInfoBoxComponent,
  type InfoBoxSection,
} from "./shared/info-box.ts";
import {
  ACTIVITY_PANEL_MIN_WIDTH,
  resolveRenderProfile,
  statusMark,
  type RenderProfile,
  type RenderStatus,
} from "./shared/render-profile.ts";
import {
  getRecentActivity,
  onActivityChange,
  recordToolEnd,
  recordToolStart,
  recordToolUpdate,
  type ActivityStatus,
} from "./shared/activity-state.ts";
import {
  getWidgetState,
  STATUS_SYMBOL,
  type SubagentEntry,
} from "./subagents/widget.ts";
import {
  WORKFLOW_MODE_LABEL,
  WORKFLOW_STATUS_EVENT,
  type WorkflowMode,
  type WorkflowStatusEvent,
} from "./shared/workflow-status.ts";

const ENABLE_ACTIVITY_PANEL = true;
const PANEL_WIDTH = "34%";
const PANEL_MIN_WIDTH = 30;
const PANEL_MAX_HEIGHT = "60%";
const PANEL_MARGIN = 1;
const MAX_TOOL_ROWS = 10;
const MAX_SUBAGENT_ROWS = 6;

const ACTIVITY_TO_RENDER_STATUS: Record<ActivityStatus, RenderStatus> = {
  pending: "idle",
  running: "running",
  completed: "completed",
  failed: "failed",
};

function buildToolLines(profile: RenderProfile): string[] {
  const entries = getRecentActivity(MAX_TOOL_ROWS);
  if (entries.length === 0) return ["(keine Aufrufe)"];
  return entries.map((entry) => {
    const symbol = statusMark(ACTIVITY_TO_RENDER_STATUS[entry.status], profile);
    return `${symbol} ${entry.label}`;
  });
}

function buildSubagentLines(): string[] {
  const subagents = Array.from(getWidgetState().subagents.values());
  if (subagents.length === 0) return [];
  return subagents
    .slice(-MAX_SUBAGENT_ROWS)
    .map(
      (entry: SubagentEntry) => `${STATUS_SYMBOL[entry.status]} ${entry.label}`,
    );
}

export default function activityPanelExtension(pi: ExtensionAPI): void {
  if (!ENABLE_ACTIVITY_PANEL) return;

  let workflowMode: WorkflowMode = "work";
  let modelId: string | undefined;
  let thinking = "-";
  let panelTui: { requestRender(): void } | undefined;
  let panelComponent: { invalidate(): void } | undefined;
  let overlayHandle: { hide(): void } | undefined;

  function refresh(): void {
    panelComponent?.invalidate();
    panelTui?.requestRender();
  }

  pi.events.on(WORKFLOW_STATUS_EVENT, (event: WorkflowStatusEvent) => {
    if (event.source === "plan") workflowMode = event.mode;
    refresh();
  });

  onActivityChange(refresh);

  pi.on("session_start", async (_event, ctx: ExtensionContext) => {
    if (ctx.mode !== "tui") return;
    modelId = ctx.model?.id;
    thinking = pi.getThinkingLevel();

    overlayHandle?.hide();
    overlayHandle = undefined;
    panelTui = undefined;
    panelComponent = undefined;

    if (typeof ctx.ui.custom !== "function") return;

    void ctx.ui
      .custom<void>(
        (tui: any, theme: any) => {
          panelTui = tui;
          const profile = resolveRenderProfile({ mode: ctx.mode });
          const box = createInfoBoxComponent(
            { title: "Activity", sections: [], tone: "accent", profile },
            theme,
          );
          panelComponent = box;

          return {
            render(width: number): string[] {
              const sections: InfoBoxSection[] = [
                {
                  lines: [
                    `Mode: ${WORKFLOW_MODE_LABEL[workflowMode]}`,
                    `Model: ${modelId ?? "-"}`,
                    `Thinking: ${thinking}`,
                  ],
                },
                { title: "Tools", lines: buildToolLines(profile) },
              ];
              const subagentLines = buildSubagentLines();
              if (subagentLines.length > 0) {
                sections.push({ title: "Subagents", lines: subagentLines });
              }
              box.setSections?.(sections);
              return box.render(width);
            },
            invalidate(): void {
              box.invalidate();
            },
          };
        },
        {
          overlay: true,
          overlayOptions: {
            anchor: "top-right",
            width: PANEL_WIDTH,
            minWidth: PANEL_MIN_WIDTH,
            maxHeight: PANEL_MAX_HEIGHT,
            margin: PANEL_MARGIN,
            nonCapturing: true,
            visible: (termWidth: number) =>
              termWidth >= ACTIVITY_PANEL_MIN_WIDTH,
          },
          onHandle: (handle: any) => {
            overlayHandle = handle;
          },
        },
      )
      .catch(() => {
        // Overlay-Erstellung ist rein optisch; schlägt sie fehl (z. B. in
        // minimalen Non-TUI-Mocks), darf das die Session nicht blockieren.
      });
  });

  pi.on("session_shutdown", async () => {
    overlayHandle?.hide();
    overlayHandle = undefined;
    panelTui = undefined;
    panelComponent = undefined;
  });

  pi.on("model_select", async (_event, ctx: ExtensionContext) => {
    modelId = ctx.model?.id;
    refresh();
  });

  pi.on("thinking_level_select", async () => {
    thinking = pi.getThinkingLevel();
    refresh();
  });

  pi.on("tool_execution_start", async (event) => {
    recordToolStart(event.toolCallId, event.toolName, event.args);
  });
  pi.on("tool_execution_update", async (event) => {
    recordToolUpdate(event.toolCallId, event.toolName, event.args);
  });
  pi.on("tool_execution_end", async (event) => {
    recordToolEnd(event.toolCallId, event.toolName, event.isError);
  });
}
