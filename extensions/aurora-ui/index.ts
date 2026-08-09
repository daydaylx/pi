import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import type {
  ExtensionAPI,
  ExtensionContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { layoutForSize } from "../shared/layout.ts";
import { loadSetupConfig, type MotionMode } from "../setup-core/config.ts";
import {
  AURORA_UI_CHANNELS,
  isAuroraUiPatchEvent,
  isAuroraUiSnapshotEvent,
  isAuroraUiStateRequest,
  mergeAuroraUiState,
  type AuroraUiState,
  type AuroraUiStatePatch,
  type AuroraUiStateRequest,
  type AuroraUiSnapshotEvent,
} from "./state.ts";
import {
  describeToolActivity,
  renderActiveTools,
  renderSubagents,
  type ActiveToolView,
  type SubagentInfo,
} from "./tool-renderers.ts";
import { renderFooterLines } from "./footer.ts";
import { crop } from "./layout.ts";
import { renderStartscreen } from "./startscreen.ts";
import { thinkingLabel, thinkingTone } from "./thinking.ts";

const OWNER = "aurora-ui";
const ACTIVITY_WIDGET = "aurora-ui/activity";
const TICK_INTERVAL_MS = 100;
const THEME_PATH = fileURLToPath(
  new URL("../../themes/aurora-night.json", import.meta.url),
);
const SUBAGENT_CONFIG_PATH = fileURLToPath(
  new URL("../subagent/config.json", import.meta.url),
);

/**
 * Once pi-subagents runs its Fleet Status Dock, that dock is the richer surface
 * for the same information: one line per agent with its concrete activity,
 * runtime and tokens, right below the editor. Aurora's activity widget hands
 * the subagent lines over instead of printing a second, poorer copy.
 *
 * Read from the subagent extension's own config rather than from a shared
 * setting: the dock is opt-in there, and only that file knows whether it is on.
 * Any read or parse problem means "no dock", i.e. the widget keeps reporting.
 * This runs once per session start, never from a render.
 */
function fleetDockOwnsSubagentDisplay(): boolean {
  try {
    const raw = JSON.parse(readFileSync(SUBAGENT_CONFIG_PATH, "utf8")) as {
      ui?: { fleetView?: unknown };
    };
    return raw.ui?.fleetView === true;
  } catch {
    return false;
  }
}

type SubagentToolArgs = {
  action?: unknown;
  async?: unknown;
  agent?: unknown;
  tasks?: unknown;
  chain?: unknown;
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function agentNamesFromTaskList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const task = record(item);
    if (!task) return [];
    const agent = typeof task.agent === "string" ? task.agent : undefined;
    const parallel = agentNamesFromTaskList(task.parallel);
    return [...(agent ? [agent] : []), ...parallel];
  });
}

function foregroundSubagentsFromArgs(args: unknown): SubagentInfo[] {
  const input = args as SubagentToolArgs | undefined;
  if (!input || input.action !== undefined || input.async === true) return [];
  const agents = [
    ...(typeof input.agent === "string" ? [input.agent] : []),
    ...agentNamesFromTaskList(input.tasks),
    ...agentNamesFromTaskList(input.chain),
  ];
  return [...new Set(agents.length > 0 ? agents : ["subagent"])].map(
    (agent) => ({
      agent,
      status: "running",
    }),
  );
}

type AsyncSubagentStartEvent = {
  id?: unknown;
  sessionId?: unknown;
  agent?: unknown;
  agents?: unknown;
  chain?: unknown;
  mode?: unknown;
};

type SubagentControlEvent = {
  type?: unknown;
  agent?: unknown;
  runId?: unknown;
};

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string => typeof item === "string" && Boolean(item),
      )
    : [];
}

/**
 * The subagent package publishes this when a background run is actually
 * launched. Keeping Aurora on that event avoids asking its status RPC, whose
 * handler executes a second, UI-initiated subagent action.
 */
function asyncSubagentsFromStart(
  value: unknown,
  sessionId: string | undefined,
): { runId: string; entries: SubagentInfo[] } | undefined {
  const event = record(value) as AsyncSubagentStartEvent | undefined;
  const runId = event?.id;
  if (!event || typeof runId !== "string") return undefined;
  if (typeof event.sessionId === "string" && event.sessionId !== sessionId)
    return undefined;
  const agents = [
    ...stringList(event.agents),
    ...stringList(event.chain),
    ...(typeof event.agent === "string" ? [event.agent] : []),
  ];
  const unique = [...new Set(agents)];
  return {
    runId,
    entries: (unique.length > 0 ? unique : ["async"]).map((agent) => ({
      agent,
      runId,
      // The package's own async tracker initially records this event as
      // queued. Do not invent a stronger lifecycle state here.
      status: "queued",
    })),
  };
}

function asyncCompletionId(
  value: unknown,
  sessionId: string | undefined,
): string | undefined {
  const event = record(value);
  if (!event || typeof event.id !== "string") return undefined;
  if (typeof event.sessionId === "string" && event.sessionId !== sessionId)
    return undefined;
  return event.id;
}

function attentionFromControlEvent(
  value: unknown,
): { runId: string; agent: string } | undefined {
  const event = record(record(value)?.event) as
    SubagentControlEvent | undefined;
  if (
    !event ||
    event.type !== "needs_attention" ||
    typeof event.runId !== "string" ||
    typeof event.agent !== "string"
  )
    return undefined;
  return { runId: event.runId, agent: event.agent };
}

function makeEpoch(sequence: number): string {
  return `${Date.now().toString(36)}-${sequence.toString(36)}`;
}

function makeState(
  epoch: string,
  ctx: ExtensionContext,
  pi: ExtensionAPI,
): AuroraUiState {
  return {
    sessionEpoch: epoch,
    workflow: { phase: "work", label: "Work" },
    permissions: {},
    lsp: {},
    model: {
      id: ctx.model?.id,
      thinking: String(pi.getThinkingLevel()),
    },
    activity: { kind: "idle", activeTools: 0 },
  };
}

class AnimationTicker {
  private timer: ReturnType<typeof setInterval> | undefined;
  private tuiRefs = new Map<TUI, number>();
  private animationActive = false;
  private disposed = false;
  frame = 0;

  constructor(
    readonly motion: MotionMode,
    private readonly onFrame: (frame: number) => void,
  ) {}

  attach(tui: TUI): () => void {
    this.tuiRefs.set(tui, (this.tuiRefs.get(tui) ?? 0) + 1);
    let attached = true;
    return () => {
      if (!attached) return;
      attached = false;
      const count = this.tuiRefs.get(tui) ?? 0;
      if (count <= 1) this.tuiRefs.delete(tui);
      else this.tuiRefs.set(tui, count - 1);
    };
  }

  requestRender(): void {
    for (const tui of this.tuiRefs.keys()) tui.requestRender();
  }

  setAnimationActive(active: boolean): void {
    this.animationActive = active && this.motion === "contextual";
    if (this.animationActive && !this.timer && !this.disposed) {
      this.timer = setInterval(() => {
        this.frame = (this.frame + 1) % 10_000;
        this.onFrame(this.frame);
        this.requestRender();
      }, TICK_INTERVAL_MS);
    } else if (!this.animationActive && this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.animationActive = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.tuiRefs.clear();
  }
}

function workingFrame(theme: Theme, motion: MotionMode, frame: number): string {
  if (motion === "off") return "";
  if (motion === "reduced") return theme.fg("accent", "●");
  const frames = ["·", "•", "●", "•"];
  const color = frame % frames.length === 2 ? "accent" : "muted";
  return theme.fg(color, frames[frame % frames.length]!);
}

export default function auroraUiExtension(pi: ExtensionAPI): void {
  let epochSequence = 0;
  let state: AuroraUiState | undefined;
  let ticker: AnimationTicker | undefined;
  let previousTheme: string | undefined;
  let selectedTheme: string | undefined;
  let activeContext: ExtensionContext | undefined;
  let activeSessionId: string | undefined;
  let disposed = true;
  let pendingRequestId: string | undefined;
  let busUnsubscribers: Array<() => void> = [];
  let subagentsCache: SubagentInfo[] = [];
  const foregroundSubagents = new Map<string, SubagentInfo[]>();
  const asyncSubagents = new Map<string, SubagentInfo[]>();
  let fleetDockOwnsSubagents = false;
  let sessionCwd: string | undefined;
  let sessionHome: string | undefined;
  let showStartscreen = false;
  const activeTools = new Map<string, ActiveToolView>();

  /**
   * The transient surface above the editor has two presentation-only variants:
   * a fresh-session welcome and current live work. Both consume cached session
   * values only; rendering neither changes a workflow nor asks another system.
   */
  function renderActivityWidget(
    theme: Theme,
    width: number,
    rows: number,
  ): string[] {
    if (!state) return [];
    if (state.activity.kind === "idle") {
      if (!showStartscreen || !sessionCwd) return [];
      return renderStartscreen(theme, {
        width,
        rows,
        workflow: state.workflow.label,
        model: state.model.id,
        thinking: state.model.thinking,
        cwd: sessionCwd,
        homeDirectory: sessionHome,
      });
    }

    const layout = layoutForSize(width, rows);
    const compact = layout === "compact";
    const heading =
      state.activity.kind === "responding"
        ? theme.fg("accent", theme.bold("◉ RESPONDING"))
        : theme.fg(
            thinkingTone(state.model.thinking),
            theme.bold(`◉ THINKING  ${thinkingLabel(state.model.thinking)}`),
          );
    const contentWidth = Math.max(1, width - (compact ? 0 : 3));
    const tools = renderActiveTools(
      [...activeTools.values()],
      theme,
      contentWidth,
      Date.now(),
      { compact },
    );
    const subagents = fleetDockOwnsSubagents
      ? []
      : renderSubagents(subagentsCache, theme, contentWidth, { compact });
    if (compact) return [crop(heading, width), ...tools, ...subagents];
    if (tools.length === 0 && subagents.length === 0)
      return [crop(heading, width)];

    const rail = (glyph: "├─" | "╰─") => theme.fg("borderMuted", `${glyph} `);
    const toolRows = tools.map(
      (line, index) =>
        `${rail(subagents.length > 0 || index < tools.length - 1 ? "├─" : "╰─")}${line}`,
    );
    const subagentRows =
      subagents.length === 0
        ? []
        : [`${rail("╰─")}${subagents[0]}`, ...subagents.slice(1)];
    return [
      crop(heading, width),
      theme.fg("borderMuted", "│"),
      ...toolRows,
      ...subagentRows,
    ];
  }

  function mergeSubagents(): void {
    const byKey = new Map<string, SubagentInfo>();
    // A foreground tool call is the most immediate fact available, so it wins
    // over the async launch event for the same agent while both are current.
    for (const entry of [
      ...[...asyncSubagents.values()].flat(),
      ...[...foregroundSubagents.values()].flat(),
    ]) {
      byKey.set(
        `${entry.agent}\u0000${entry.phase ?? ""}\u0000${entry.label ?? ""}`,
        entry,
      );
    }
    subagentsCache = [...byKey.values()];
  }

  /** All subagent data arrives through a real package event, never a render RPC. */
  function refreshSubagentDisplay(): void {
    mergeSubagents();
    ticker?.requestRender();
  }

  /**
   * An async child is still real current work after its parent tool returns.
   * Keep the otherwise-transient widget visible until that child's own
   * completion event arrives; no completed entry is retained afterwards.
   */
  function retainAsyncActivity(ctx: ExtensionContext): void {
    if (asyncSubagents.size === 0) return;
    updateState(ctx, {
      activity: {
        kind: "tool",
        label: `${subagentsCache.length} Subagent${subagentsCache.length === 1 ? "" : "en"} aktiv`,
        activeTools: activeTools.size,
      },
    });
  }

  function applyWorking(ctx: ExtensionContext): void {
    if (!state || !ticker) return;
    const active = state.activity.kind !== "idle";
    ticker.setAnimationActive(active);

    // Aurora's activity widget is the single live-work surface. Keeping Pi's
    // native indicator visible as well creates a second moving signal next to
    // the editor; motion is rendered by the widget itself when enabled.
    ctx.ui.setWorkingVisible(false);
  }

  function updateState(ctx: ExtensionContext, patch: AuroraUiStatePatch): void {
    if (
      !state ||
      disposed ||
      ctx.sessionManager.getSessionId() !== activeSessionId
    )
      return;
    mergeAuroraUiState(state, patch);
    ticker?.requestRender();
    if (patch.activity) applyWorking(ctx);
  }

  function emitSnapshot(request: AuroraUiStateRequest): void {
    if (!state || request.sessionEpoch !== state.sessionEpoch) return;
    const event: AuroraUiSnapshotEvent = {
      type: "snapshot",
      requestId: request.requestId,
      sessionEpoch: state.sessionEpoch,
      source: OWNER,
      state: {
        workflow: { ...state.workflow },
        permissions: { ...state.permissions },
        lsp: { ...state.lsp },
        model: { ...state.model },
        activity: { ...state.activity },
      },
    };
    pi.events.emit(AURORA_UI_CHANNELS.snapshot, event);
  }

  function installBus(ctx: ExtensionContext): void {
    if (!state) return;
    busUnsubscribers = [
      pi.events.on(AURORA_UI_CHANNELS.request, (value) => {
        if (!isAuroraUiStateRequest(value) || value.requester === OWNER) return;
        emitSnapshot(value);
      }),
      pi.events.on(AURORA_UI_CHANNELS.patch, (value) => {
        if (
          !state ||
          !isAuroraUiPatchEvent(value) ||
          value.sessionEpoch !== state.sessionEpoch
        )
          return;
        updateState(ctx, value.patch);
      }),
      pi.events.on(AURORA_UI_CHANNELS.snapshot, (value) => {
        if (
          !state ||
          !pendingRequestId ||
          !isAuroraUiSnapshotEvent(value) ||
          value.requestId !== pendingRequestId ||
          value.sessionEpoch !== state.sessionEpoch
        )
          return;
        updateState(ctx, value.state);
      }),
      pi.events.on("subagent:async-started", (value) => {
        if (disposed) return;
        const started = asyncSubagentsFromStart(value, activeSessionId);
        if (!started) return;
        asyncSubagents.set(started.runId, started.entries);
        refreshSubagentDisplay();
        retainAsyncActivity(ctx);
      }),
      pi.events.on("subagent:async-complete", (value) => {
        if (disposed) return;
        const runId = asyncCompletionId(value, activeSessionId);
        if (!runId || !asyncSubagents.delete(runId)) return;
        refreshSubagentDisplay();
        if (
          asyncSubagents.size === 0 &&
          activeTools.size === 0 &&
          state?.activity.kind === "tool"
        ) {
          updateState(ctx, {
            activity: { kind: "idle", label: undefined, activeTools: 0 },
          });
        }
      }),
      pi.events.on("subagent:control-event", (value) => {
        if (disposed) return;
        const attention = attentionFromControlEvent(value);
        if (!attention) return;
        const entries = asyncSubagents.get(attention.runId);
        if (!entries) return;
        const updated = entries.map((entry) =>
          entry.agent === attention.agent
            ? { ...entry, status: "needs_attention" as const }
            : entry,
        );
        asyncSubagents.set(attention.runId, updated);
        refreshSubagentDisplay();
      }),
    ];

    pendingRequestId = `${state.sessionEpoch}:${OWNER}`;
    pi.events.emit(AURORA_UI_CHANNELS.request, {
      type: "request",
      requestId: pendingRequestId,
      sessionEpoch: state.sessionEpoch,
      requester: OWNER,
    } satisfies AuroraUiStateRequest);
  }

  function disposeSession(ctx?: ExtensionContext): void {
    if (disposed) return;
    disposed = true;
    for (const unsubscribe of busUnsubscribers.splice(0)) unsubscribe();
    pendingRequestId = undefined;
    activeTools.clear();
    foregroundSubagents.clear();
    asyncSubagents.clear();
    subagentsCache = [];
    ticker?.dispose();
    ticker = undefined;

    const uiContext = ctx ?? activeContext;
    if (uiContext?.mode === "tui" && uiContext.hasUI) {
      uiContext.ui.setFooter(undefined);
      uiContext.ui.setWidget(ACTIVITY_WIDGET, undefined);
      uiContext.ui.setWorkingVisible(false);
      uiContext.ui.setWorkingMessage();
      uiContext.ui.setWorkingIndicator();
      if (
        previousTheme &&
        selectedTheme &&
        uiContext.ui.theme.name === selectedTheme &&
        previousTheme !== selectedTheme
      ) {
        uiContext.ui.setTheme(previousTheme);
      }
    }
    state = undefined;
    sessionCwd = undefined;
    sessionHome = undefined;
    showStartscreen = false;
    activeContext = undefined;
    activeSessionId = undefined;
    previousTheme = undefined;
    selectedTheme = undefined;
  }

  pi.on("resources_discover", () => ({ themePaths: [THEME_PATH] }));

  pi.on("session_start", (_event, ctx) => {
    disposeSession(activeContext);
    if (ctx.mode !== "tui" || !ctx.hasUI) return;

    const loaded = loadSetupConfig(ctx.cwd, ctx.isProjectTrusted());
    fleetDockOwnsSubagents = fleetDockOwnsSubagentDisplay();
    sessionCwd = ctx.cwd;
    sessionHome = homedir();
    showStartscreen = !ctx.sessionManager
      .getEntries()
      .some((entry: { type?: string }) => entry.type === "message");
    const epoch = makeEpoch(++epochSequence);
    state = makeState(epoch, ctx, pi);
    // The permission label is deliberately left empty: it means the permission
    // mode, and only `permissions/session-state.ts` knows it. That extension
    // answers the state request emitted by `installBus` below, still inside
    // this handler. Seeding it from `permissions.bash` — a different setting
    // entirely — is what used to put the bash policy under a mode label.
    state.lsp.state = loaded.config.lsp.enabled ? "leerlauf" : "aus";
    activeContext = ctx;
    activeSessionId = ctx.sessionManager.getSessionId();
    disposed = false;

    previousTheme = ctx.ui.theme.name;
    selectedTheme = loaded.config.ui.theme;
    const themeResult = ctx.ui.setTheme(selectedTheme);
    if (!themeResult.success) {
      ctx.ui.notify(
        `Aurora theme: ${themeResult.error ?? "nicht verfügbar"}`,
        "warning",
      );
    }

    ticker = new AnimationTicker(loaded.config.ui.motion, () => {});

    const sessionCtx = ctx;
    ctx.ui.setFooter((tui, theme, footerData) => {
      const detachTicker = ticker!.attach(tui);
      // The footer reports the context share, which moves as the branch grows.
      // The subscription exists to schedule a repaint, not to read anything:
      // a value that only changes on an event is only redrawn on that event.
      const unsubscribeBranch = footerData.onBranchChange(() =>
        tui.requestRender(),
      );

      return {
        invalidate() {},
        dispose() {
          unsubscribeBranch();
          detachTicker();
        },
        render(width: number): string[] {
          if (!state) return [];
          return renderFooterLines(theme, width, {
            state,
            statuses: footerData.getExtensionStatuses(),
            contextPercent: sessionCtx.getContextUsage()?.percent ?? null,
            cwd: sessionCwd,
            homeDirectory: sessionHome,
          });
        },
      };
    });

    ctx.ui.setWidget(
      ACTIVITY_WIDGET,
      (tui, theme) => {
        const detachTicker = ticker!.attach(tui);
        return {
          invalidate() {},
          dispose: detachTicker,
          render: (width: number) =>
            renderActivityWidget(
              theme,
              width,
              (tui as unknown as { terminal?: { rows?: number } }).terminal
                ?.rows ?? 24,
            ),
        };
      },
      { placement: "aboveEditor" },
    );
    ctx.ui.setWorkingVisible(false);
    ctx.ui.setWorkingIndicator(
      loaded.config.ui.motion === "off"
        ? { frames: [] }
        : {
            frames: [workingFrame(ctx.ui.theme, loaded.config.ui.motion, 0)],
          },
    );
    installBus(ctx);
  });

  pi.on("before_agent_start", () => {
    showStartscreen = false;
    ticker?.requestRender();
  });

  pi.on("agent_start", (_event, ctx) => {
    showStartscreen = false;
    activeTools.clear();
    foregroundSubagents.clear();
    refreshSubagentDisplay();
    updateState(ctx, {
      activity: {
        kind: "thinking",
        // The real configured depth, never a guess: this is the only place
        // thinking is visible while `hideThinkingBlock` is set.
        label: `Thinking · ${pi.getThinkingLevel()}`,
        activeTools: 0,
      },
    });
  });

  pi.on("tool_execution_start", (event, ctx) => {
    activeTools.set(event.toolCallId, {
      id: event.toolCallId,
      name: event.toolName,
      ...describeToolActivity(event.toolName, event.args),
      startedAt: Date.now(),
    });
    if (event.toolName === "subagent") {
      const subagents = foregroundSubagentsFromArgs(event.args);
      if (subagents.length > 0)
        foregroundSubagents.set(event.toolCallId, subagents);
      refreshSubagentDisplay();
    }
    updateState(ctx, {
      activity: {
        kind: "tool",
        label: `${activeTools.size} Tool${activeTools.size === 1 ? "" : "s"} aktiv`,
        activeTools: activeTools.size,
      },
    });
  });

  pi.on("tool_execution_update", (event) => {
    const partial = record(event.partialResult);
    if (partial?.isError !== true) return;
    const tool = activeTools.get(event.toolCallId);
    if (!tool || tool.tone === "error") return;
    tool.tone = "error";
    ticker?.requestRender();
  });

  pi.on("tool_execution_end", (event, ctx) => {
    activeTools.delete(event.toolCallId);
    if (event.toolName === "subagent") {
      foregroundSubagents.delete(event.toolCallId);
      refreshSubagentDisplay();
    }
    updateState(ctx, {
      activity:
        activeTools.size > 0
          ? {
              kind: "tool",
              label: `${activeTools.size} Tool${activeTools.size === 1 ? "" : "s"} aktiv`,
              activeTools: activeTools.size,
            }
          : asyncSubagents.size > 0
            ? {
                kind: "tool",
                label: `${subagentsCache.length} Subagent${subagentsCache.length === 1 ? "" : "en"} aktiv`,
                activeTools: 0,
              }
            : {
                kind: "responding",
                label: undefined,
                activeTools: 0,
              },
    });
  });

  pi.on("message_update", (event, ctx) => {
    if (!event.assistantMessageEvent.type.startsWith("text_")) return;
    activeTools.clear();
    foregroundSubagents.clear();
    refreshSubagentDisplay();
    if (asyncSubagents.size > 0) {
      retainAsyncActivity(ctx);
      return;
    }
    updateState(ctx, {
      activity: { kind: "idle", label: undefined, activeTools: 0 },
    });
  });

  pi.on("model_select", (event, ctx) => {
    updateState(ctx, { model: { id: event.model.id } });
  });

  pi.on("thinking_level_select", (event, ctx) => {
    updateState(ctx, { model: { thinking: String(event.level) } });
  });

  const settle = (_event: unknown, ctx: ExtensionContext) => {
    activeTools.clear();
    foregroundSubagents.clear();
    refreshSubagentDisplay();
    if (asyncSubagents.size > 0) {
      retainAsyncActivity(ctx);
      return;
    }
    updateState(ctx, {
      activity: { kind: "idle", label: undefined, activeTools: 0 },
    });
  };
  pi.on("agent_end", settle);
  pi.on("agent_settled", settle);
  pi.on("session_shutdown", (_event, ctx) => disposeSession(ctx));
}
