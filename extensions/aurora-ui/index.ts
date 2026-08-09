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
  compactToolTarget,
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
/**
 * Bursts of subagent events collapse into one status request. Nothing here
 * runs on a timer: the window only opens once an event has already arrived.
 */
const SUBAGENT_COALESCE_MS = 300;
const SUBAGENT_RPC_TIMEOUT_MS = 1_000;
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

function textFromRpcReply(reply: unknown): string {
  const envelope = record(reply);
  const data = record(envelope?.data);
  // The RPC bridge serializes AgentToolResult text as data.text. Keep the
  // content-array fallback for the older bridge envelope.
  if (typeof data?.text === "string") return data.text;
  const content = data?.content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((item) => {
      const part = record(item);
      return typeof part?.text === "string" ? [part.text] : [];
    })
    .join("\n");
}

function asyncSubagentsFromRpcReply(reply: unknown): SubagentInfo[] {
  const envelope = record(reply);
  if (!envelope || envelope.success !== true) return [];

  // This accepts the early structured bridge format too. The pinned bridge
  // serializes its AgentToolResult text through data.text.
  const data = record(envelope.data);
  if (Array.isArray(data?.runs)) {
    return data.runs.flatMap((item) => {
      const run = record(item);
      if (!run || typeof run.status !== "string") return [];
      const config = record(run.config);
      return [
        {
          agent: typeof config?.agent === "string" ? config.agent : "async",
          phase: typeof config?.phase === "string" ? config.phase : undefined,
          label: typeof config?.label === "string" ? config.label : undefined,
          status: run.status as SubagentInfo["status"],
        },
      ];
    });
  }

  const runs: SubagentInfo[] = [];
  const linePattern =
    /^-\s+([^|\s]+)\s+\|\s+(queued|running)\b[^|]*\|\s+(single|parallel|chain)\b/gm;
  for (const match of textFromRpcReply(reply).matchAll(linePattern)) {
    runs.push({
      agent: match[3] === "single" ? "async" : match[3]!,
      phase: match[1],
      status: match[2] as SubagentInfo["status"],
    });
  }
  return runs;
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
  let asyncSubagentsCache: SubagentInfo[] = [];
  const foregroundSubagents = new Map<string, SubagentInfo[]>();
  let subagentsFetchInFlight: Promise<void> | undefined;
  let subagentsCoalesceTimer: ReturnType<typeof setTimeout> | undefined;
  /** An event arrived while a request was in flight; ask again once, after. */
  let subagentRefreshPending = false;
  /**
   * Bumped whenever a session ends. A reply carries the generation it was asked
   * under, so an answer that outlives its session cannot write into the next
   * one — the request itself is not cancellable, but its result is ignorable.
   */
  let subagentGeneration = 0;
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
    const toolRows = tools.map((line, index) =>
      `${rail(subagents.length > 0 || index < tools.length - 1 ? "├─" : "╰─")}${line}`,
    );
    const subagentRows =
      subagents.length === 0
        ? []
        : [`${rail("╰─")}${subagents[0]}`, ...subagents.slice(1)];
    return [crop(heading, width), theme.fg("borderMuted", "│"), ...toolRows, ...subagentRows];
  }

  function mergeSubagents(): void {
    const byKey = new Map<string, SubagentInfo>();
    for (const entry of [
      ...[...foregroundSubagents.values()].flat(),
      ...asyncSubagentsCache,
    ]) {
      byKey.set(
        `${entry.agent}\u0000${entry.phase ?? ""}\u0000${entry.label ?? ""}`,
        entry,
      );
    }
    subagentsCache = [...byKey.values()];
  }

  /** True while the answer to a request asked under `generation` still counts. */
  function subagentReplyStillWanted(generation: number): boolean {
    return !disposed && generation === subagentGeneration;
  }

  async function requestSubagentStatus(generation: number): Promise<void> {
    const requestId = crypto.randomUUID();
    // Subscribe before emitting, await after: a reply that arrives
    // synchronously must still find its listener.
    const reply = new Promise<unknown>((resolve) => {
      const unsubscribe = pi.events.on(
        `subagents:rpc:v1:reply:${requestId}`,
        (value: unknown) => {
          unsubscribe();
          resolve(value);
        },
      );
      setTimeout(() => {
        unsubscribe();
        resolve(null);
      }, SUBAGENT_RPC_TIMEOUT_MS);
    });
    pi.events.emit("subagents:rpc:v1:request", {
      version: 1,
      requestId,
      method: "status",
      params: {},
    });
    const value = await reply;
    if (!subagentReplyStillWanted(generation)) return;
    asyncSubagentsCache = asyncSubagentsFromRpcReply(value);
  }

  /**
   * Async subagent runs are only knowable by asking the subagent package, and
   * this is the one place that asks. It is reached from the subagent event
   * handler alone — never from a render — so the cost is bounded by how often
   * subagents actually change state, not by the frame rate. A burst of events
   * collapses into a single request.
   *
   * An event that arrives while a request is already in flight would otherwise
   * be lost, leaving the cache stale for as long as nothing else happens. It
   * sets a single pending flag instead, so any number of such events produce
   * exactly one follow-up request once the current one has answered.
   */
  function refreshSubagents(): void {
    if (fleetDockOwnsSubagents || disposed) return;
    if (subagentsFetchInFlight) {
      subagentRefreshPending = true;
      return;
    }
    if (subagentsCoalesceTimer) return;
    subagentsCoalesceTimer = setTimeout(() => {
      subagentsCoalesceTimer = undefined;
      if (disposed) return;
      if (subagentsFetchInFlight) {
        subagentRefreshPending = true;
        return;
      }
      const generation = subagentGeneration;
      subagentsFetchInFlight = requestSubagentStatus(generation)
        .catch(() => {
          if (subagentReplyStillWanted(generation)) asyncSubagentsCache = [];
        })
        .finally(() => {
          // A stale request touches nothing at all — not even the in-flight
          // gate, which by now may belong to the session that replaced it.
          if (!subagentReplyStillWanted(generation)) return;
          subagentsFetchInFlight = undefined;
          mergeSubagents();
          ticker?.requestRender();
          if (!subagentRefreshPending) return;
          subagentRefreshPending = false;
          refreshSubagents();
        });
    }, SUBAGENT_COALESCE_MS);
  }

  /** Foreground runs are known from the tool call itself; no request needed. */
  function refreshForegroundSubagents(): void {
    mergeSubagents();
    ticker?.requestRender();
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
      // The one trigger for an async subagent status request. It lives with
      // the session rather than with a component, so the request cannot be
      // tied to how often anything happens to repaint.
      pi.events.on("subagent:control-event", () => refreshSubagents()),
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
    subagentsCache = [];
    asyncSubagentsCache = [];
    // A request already on the wire cannot be recalled, so retire the
    // generation it was asked under: whenever it answers, it answers for a
    // session that no longer exists and is dropped instead of applied.
    subagentGeneration += 1;
    subagentRefreshPending = false;
    subagentsFetchInFlight = undefined;
    if (subagentsCoalesceTimer) clearTimeout(subagentsCoalesceTimer);
    subagentsCoalesceTimer = undefined;
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
    refreshForegroundSubagents();
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
      target: compactToolTarget(event.toolName, event.args),
      startedAt: Date.now(),
    });
    if (event.toolName === "subagent") {
      const subagents = foregroundSubagentsFromArgs(event.args);
      if (subagents.length > 0)
        foregroundSubagents.set(event.toolCallId, subagents);
      refreshForegroundSubagents();
      refreshSubagents();
    }
    updateState(ctx, {
      activity: {
        kind: "tool",
        label: `${activeTools.size} Tool${activeTools.size === 1 ? "" : "s"} aktiv`,
        activeTools: activeTools.size,
      },
    });
  });

  pi.on("tool_execution_end", (event, ctx) => {
    activeTools.delete(event.toolCallId);
    if (event.toolName === "subagent") {
      foregroundSubagents.delete(event.toolCallId);
      refreshForegroundSubagents();
      refreshSubagents();
    }
    updateState(ctx, {
      activity:
        activeTools.size > 0
          ? {
              kind: "tool",
              label: `${activeTools.size} Tool${activeTools.size === 1 ? "" : "s"} aktiv`,
              activeTools: activeTools.size,
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
    refreshForegroundSubagents();
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
    refreshForegroundSubagents();
    updateState(ctx, {
      activity: { kind: "idle", label: undefined, activeTools: 0 },
    });
  };
  pi.on("agent_end", settle);
  pi.on("agent_settled", settle);
  pi.on("session_shutdown", (_event, ctx) => disposeSession(ctx));
}
