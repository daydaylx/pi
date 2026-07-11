/**
 * Nicht überlagernde Live-Aktivitätsanzeige.
 *
 * Das Widget ergänzt den unveränderten Tool-Verlauf. Es verwendet bewusst
 * ausschließlich `setWidget`: Die TUI reserviert dadurch echte Zeilen und
 * kein Inhalt im Hauptbereich wird überdeckt.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { createInfoBoxComponent } from "./shared/info-box.ts";
import {
  glyphsFor,
  resolveRenderProfile,
  truncatePlain,
  type RenderProfile,
  type RenderStatus,
} from "./shared/render-profile.ts";
import {
  getActiveActivity,
  getRecentActivity,
  onActivityChange,
  recordToolEnd,
  recordToolStart,
  recordToolUpdate,
  resetActivityState,
  type ActivityEntry,
  type ActivityStatus,
} from "./shared/activity-state.ts";
import { getWidgetState, STATUS_SYMBOL } from "./subagents/widget.ts";
import { loadUiConfig, type UiActivityMode } from "./shared/ui-config.ts";
import {
  WORKFLOW_MODE_LABEL,
  WORKFLOW_STATUS_EVENT,
  type WorkflowMode,
  type WorkflowStatusEvent,
} from "./shared/workflow-status.ts";

const WIDGET_KEY = "activity-status";
const MAX_AUTO_ROWS = 3;
const MAX_ON_ROWS = 6;
const MAX_DEBUG_ROWS = 10;

const ACTIVITY_TO_RENDER_STATUS: Record<ActivityStatus, RenderStatus> = {
  pending: "idle",
  running: "running",
  completed: "completed",
  failed: "failed",
};

const ACTIVITY_STATUS_LABEL: Record<ActivityStatus, string> = {
  pending: "wartet",
  running: "läuft",
  completed: "erledigt",
  failed: "fehlgeschlagen",
};

const SUBAGENT_STATUS_LABEL: Record<string, string> = {
  idle: "inaktiv",
  queued: "eingereiht",
  waiting: "wartet",
  running: "läuft",
  done: "erledigt",
  completed: "erledigt",
  warning: "Warnung",
  failed: "fehlgeschlagen",
  blocked: "blockiert",
};

const ACTIVITY_MODE_LABEL: Record<UiActivityMode, string> = {
  auto: "automatisch",
  on: "an",
  compact: "kompakt",
  off: "aus",
  debug: "Diagnose",
};

function activityLine(entry: ActivityEntry, profile: RenderProfile): string {
  const glyphs = glyphsFor(profile);
  const symbol = glyphs.status[ACTIVITY_TO_RENDER_STATUS[entry.status]];
  return `${symbol} ${entry.label}`;
}

function debugActivityLine(
  entry: ActivityEntry,
  profile: RenderProfile,
): string {
  return `${activityLine(entry, profile)} · ${ACTIVITY_STATUS_LABEL[entry.status]}`;
}

function compactLines(
  entries: ActivityEntry[],
  profile: RenderProfile,
  width: number,
  maxRows: number,
): string[] {
  const glyphs = glyphsFor(profile);
  const visible = entries.slice(0, maxRows);
  const lines = visible.map((entry) =>
    truncatePlain(activityLine(entry, profile), width, glyphs.ellipsis),
  );
  const remaining = entries.length - visible.length;
  if (remaining > 0 && lines.length > 0) {
    const last = lines.length - 1;
    lines[last] = truncatePlain(
      `${lines[last]} · +${remaining} weitere`,
      width,
      glyphs.ellipsis,
    );
  }
  return lines;
}

export default function activityPanelExtension(pi: ExtensionAPI): void {
  let activityMode: UiActivityMode = loadUiConfig().activity;
  let workflowMode: WorkflowMode = "work";
  let modelId: string | undefined;
  let thinking = "-";
  let widgetUi: ExtensionContext["ui"] | undefined;
  let widgetTui: { requestRender(): void } | undefined;
  let widgetComponent: { invalidate(): void } | undefined;

  function refresh(): void {
    widgetComponent?.invalidate();
    widgetTui?.requestRender();
  }

  function clearWidget(): void {
    widgetUi?.setWidget(WIDGET_KEY, undefined);
    widgetTui = undefined;
    widgetComponent = undefined;
  }

  function installWidget(ctx: ExtensionContext): void {
    widgetUi = ctx.ui;
    if (ctx.mode !== "tui" || activityMode === "off") {
      clearWidget();
      return;
    }

    ctx.ui.setWidget(
      WIDGET_KEY,
      (tui, theme) => {
        widgetTui = tui;
        const component = {
          render(width: number): string[] {
            const profile = resolveRenderProfile({ mode: ctx.mode, width });
            const recent = getRecentActivity(MAX_DEBUG_ROWS);

            if (activityMode === "auto") {
              return compactLines(
                getActiveActivity(),
                profile,
                width,
                MAX_AUTO_ROWS,
              );
            }

            if (activityMode === "compact") {
              const entry = getActiveActivity(1)[0] ?? recent[0];
              return entry
                ? compactLines([entry], profile, width, 1)
                : [theme.fg("muted", "Aktivität: keine Werkzeugaufrufe")];
            }

            if (activityMode === "on") {
              const lines = compactLines(
                recent,
                profile,
                width,
                MAX_ON_ROWS,
              );
              return [
                theme.fg("accent", theme.bold("Aktivität")),
                ...(lines.length > 0
                  ? lines
                  : [theme.fg("muted", "Keine Werkzeugaufrufe")]),
              ];
            }

            const toolLines = recent.map((entry) =>
              debugActivityLine(entry, profile),
            );
            const subagentLines = Array.from(
              getWidgetState().subagents.values(),
            )
              .slice(-6)
              .map((entry) => {
                const task = entry.currentTask ? ` · ${entry.currentTask}` : "";
                const status =
                  SUBAGENT_STATUS_LABEL[entry.status] ?? entry.status;
                return `${STATUS_SYMBOL[entry.status]} ${entry.label} · ${status}${task}`;
              });
            const box = createInfoBoxComponent(
              {
                title: "Aktivitätsdiagnose",
                sections: [
                  {
                    title: "Sitzung",
                    lines: [
                      `Modus: ${WORKFLOW_MODE_LABEL[workflowMode]}`,
                      `Modell: ${modelId ?? "-"}`,
                      `Denken: ${thinking}`,
                    ],
                  },
                  {
                    title: "Werkzeuge",
                    lines:
                      toolLines.length > 0
                        ? toolLines
                        : ["Keine Werkzeugaufrufe"],
                  },
                  ...(subagentLines.length > 0
                    ? [{ title: "Subagenten", lines: subagentLines }]
                    : []),
                ],
                tone: "accent",
                profile,
              },
              theme,
            );
            return box.render(width);
          },
          invalidate(): void {},
        };
        widgetComponent = component;
        return component;
      },
      { placement: "aboveEditor" },
    );
  }

  pi.events.on(WORKFLOW_STATUS_EVENT, (event: WorkflowStatusEvent) => {
    if (event.source === "plan") workflowMode = event.mode;
    refresh();
  });

  onActivityChange(refresh);

  pi.registerCommand("activity", {
    description:
      "Aktivitätsanzeige: auto | on | compact | off | debug (nur diese Sitzung)",
    handler: async (args, ctx) => {
      const requested = args.trim().toLowerCase();
      if (
        requested !== "auto" &&
        requested !== "on" &&
        requested !== "compact" &&
        requested !== "off" &&
        requested !== "debug"
      ) {
        ctx.ui.notify(
          "Nutzung: /activity auto | on | compact | off | debug",
          "info",
        );
        return;
      }
      activityMode = requested;
      installWidget(ctx);
      ctx.ui.notify(
        `Aktivitätsanzeige: ${ACTIVITY_MODE_LABEL[requested]} (nur diese Sitzung).`,
        "info",
      );
    },
  });

  pi.on("session_start", async (_event, ctx: ExtensionContext) => {
    resetActivityState();
    activityMode = loadUiConfig().activity;
    modelId = ctx.model?.id;
    thinking = pi.getThinkingLevel();
    installWidget(ctx);
  });

  pi.on("session_shutdown", async () => {
    clearWidget();
    widgetUi = undefined;
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
