import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import type {
  ExtensionAPI,
  ExtensionContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import {
  dashboardOwnsVerification,
  layoutForSize,
} from "../shared/layout.ts";
import { isPlanningMode } from "../shared/workflow-mode.ts";
import { readPlan } from "../plan-mode/plan-file.ts";
import {
  loadSetupConfig,
  persistUiPreference,
  type DashboardMode,
  type MotionMode,
} from "../setup-core/config.ts";
import { catalogDescription } from "../shared/command-catalog.ts";
import { runMenu } from "../shared/menu-ui.ts";
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
  hiddenActivitySummary,
  renderActiveTools,
  renderAutoDashboard,
  renderDashboard,
  renderSubagentBranches,
  type ActiveToolView,
  type SubagentInfo,
} from "./tool-renderers.ts";
import { renderFooterLines } from "./footer.ts";
import { renderStartscreen } from "./startscreen.ts";
import { thinkingLabel, thinkingTone } from "./thinking.ts";
import { ReceiptAggregator } from "./receipts.ts";
import { auroraDiagnostics } from "./dev-diagnostics.ts";
import {
  projectTaskViewModel,
  verificationIsStale,
} from "./task-projection.ts";
import type { TaskViewModel } from "./task-view-model.ts";
import { registerInspectorCommand } from "./inspector-command.ts";
export {
  renderInspectorBox,
  type InspectorContent,
  type InspectorSection,
} from "./inspector.ts";
export {
  ReceiptAggregator,
  receiptGlyph,
  renderReceiptLines,
} from "./receipts.ts";
export {
  determineTaskPhase,
  extractTaskTitle,
  projectCurrentWork,
  projectSubagentBranches,
  projectTaskViewModel,
  projectVerificationState,
} from "./task-projection.ts";
export type {
  CurrentWorkViewModel,
  FindingSeverity,
  ReceiptKind,
  ReceiptStatus,
  SubagentBranchInfo,
  TaskChangesSummary,
  TaskFinding,
  TaskPhase,
  TaskReceipt,
  TaskViewModel,
  VerificationCriterion,
  VerificationViewModel,
} from "./task-view-model.ts";
export {
  renderChangingFiles,
  renderDashboard,
  renderProgressBar,
  renderSubagentBranches,
  renderTaskHeader,
  renderTaskWorkspace,
  renderVerificationBlock,
} from "./tool-renderers.ts";

const OWNER = "aurora-ui";
const ACTIVITY_WIDGET = "aurora-ui/activity";
const TICK_INTERVAL_MS = 100;
const STATUS_TICK_INTERVAL_MS = 1_000;
/** A running turn without a concrete Aurora event is presented as WARTET AUF MODELL. */
const WAITING_THRESHOLD_MS = 4_000;
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

function foregroundSubagentsFromArgs(
  args: unknown,
  runId: string,
): SubagentInfo[] {
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
      runId,
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
    activity: { kind: "idle" },
    changes: null,
    verification: null,
  };
}

class AnimationTicker {
  private timer: ReturnType<typeof setInterval> | undefined;
  private tuiRefs = new Map<TUI, number>();
  private intervalMs: number | undefined;
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

  setActivity(active: boolean, animate: boolean): void {
    const intervalMs = active
      ? this.motion === "contextual" && animate
        ? TICK_INTERVAL_MS
        : STATUS_TICK_INTERVAL_MS
      : undefined;
    if (intervalMs === this.intervalMs) return;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.intervalMs = intervalMs;
    auroraDiagnostics.recordTickInterval(intervalMs ?? null);
    if (!intervalMs || this.disposed) return;
    this.timer = setInterval(() => {
      this.frame = (this.frame + 1) % 10_000;
      this.onFrame(this.frame);
      this.requestRender();
    }, intervalMs);
  }

  dispose(): void {
    this.disposed = true;
    this.intervalMs = undefined;
    auroraDiagnostics.recordTickInterval(null);
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.tuiRefs.clear();
  }
}

type DisplayActivityKind = "thinking" | "tool" | "responding" | "waiting";

function activityPresentation(
  state: AuroraUiState,
  activeTools: number,
  activeAsyncRuns: number,
  now: number,
  activityStartedAt: number,
  lastRelevantActivityAt: number,
): { kind: DisplayActivityKind; startedAt: number; label: string } {
  const waiting =
    state.activity.kind !== "tool" &&
    activeTools === 0 &&
    activeAsyncRuns === 0 &&
    lastRelevantActivityAt > 0 &&
    now - lastRelevantActivityAt >= WAITING_THRESHOLD_MS;
  if (waiting)
    return {
      kind: "waiting",
      startedAt: lastRelevantActivityAt + WAITING_THRESHOLD_MS,
      label: "WARTET AUF MODELL",
    };
  // Tool events are Aurora's factual activity source. A tool can reach the
  // dashboard one frame before the coarser agent state changes, so never hide
  // concrete work behind an inherited idle state.
  if (activeTools > 0)
    return { kind: "tool", startedAt: activityStartedAt, label: "ARBEITET" };
  switch (state.activity.kind) {
    case "thinking":
      return {
        kind: "thinking",
        startedAt: activityStartedAt,
        label: "DENKT NACH",
      };
    case "tool":
      return { kind: "tool", startedAt: activityStartedAt, label: "ARBEITET" };
    case "responding":
      return {
        kind: "responding",
        startedAt: activityStartedAt,
        label: "ANTWORTET",
      };
    case "idle":
      return {
        kind: "waiting",
        startedAt: activityStartedAt,
        label: "WARTET AUF MODELL",
      };
  }
}

/**
 * Only thinking and running tools are actual moving work, so only they animate.
 * Responding and waiting keep a fixed glyph: their widget line is still
 * repainted once a second, but for the elapsed time, not for a new frame.
 */
function activityGlyph(
  theme: Theme,
  motion: MotionMode,
  frame: number,
  kind: DisplayActivityKind,
): string {
  if (kind === "waiting") return theme.fg("muted", "·");
  if (motion === "off") return "";
  if (kind === "responding") return theme.fg("accent", "•");
  if (motion === "reduced") return theme.fg("accent", "●");
  const frames = ["·", "•", "●", "•"];
  const color = frame % frames.length === 2 ? "accent" : "muted";
  return theme.fg(color, frames[frame % frames.length]!);
}

export default function auroraUiExtension(pi: ExtensionAPI): void {
  let epochSequence = 0;
  let state: AuroraUiState | undefined;
  // Last task view model computed by renderActivityWidget, reused by the
  // inspector command so it never re-derives verification independently.
  let lastTask: TaskViewModel | undefined;
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
  let currentUserPrompt: string | undefined;
  let currentPlanText: string | undefined;
  let lastVerificationStatus: string | null = null;
  let workspaceChangedSinceVerification = false;
  // One owner: ui.dashboard from setup.json, switched via /dashboard
  // (Super+Q Command Center entry), read per frame by the widget.
  let dashboardMode: DashboardMode = "auto";
  let showStartscreen = false;
  const activeTools = new Map<string, ActiveToolView>();
  const receiptAggregator = new ReceiptAggregator();
  // Presentation-only timestamps: neither is published nor part of Aurora's
  // activity-state contract.
  let activityStartedAt = 0;
  let lastRelevantActivityAt = 0;
  // This records only that Pi has emitted a real turn-completion event while
  // an async child remains visible; it does not introduce another activity
  // state or lifecycle source.
  let turnSettledWhileAsync = false;

  /**
   * The surface above the editor is a fresh-session welcome followed by a
   * persistent dashboard. It consumes cached runtime values only: rendering
   * never changes workflow state or asks another system for information.
   */
  function renderActivityWidget(
    theme: Theme,
    width: number,
    rows: number,
  ): string[] {
    return auroraDiagnostics.measure(() =>
      renderActivityWidgetMeasured(theme, width, rows),
    );
  }

  function renderActivityWidgetMeasured(
    theme: Theme,
    width: number,
    rows: number,
  ): string[] {
    if (!state) return [];
    if (dashboardMode === "hidden") return [];
    if (state.activity.kind === "idle" && showStartscreen && sessionCwd) {
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
    const now = Date.now();
    const toolViews = [...activeTools.values()];
    const agentViews = fleetDockOwnsSubagents
      ? []
      : [...subagentsCache].sort(
          (a, b) =>
            Number(b.status === "needs_attention") -
            Number(a.status === "needs_attention"),
        );
    const task = projectTaskViewModel({
      state,
      activeTools,
      subagents: agentViews,
      receiptAggregator,
      now,
      verificationStatus: lastVerificationStatus,
      workspaceChangedSinceVerification,
      currentPlan: currentPlanText,
      userPrompt: currentUserPrompt,
      contextPercent: activeContext?.getContextUsage()?.percent ?? null,
    });
    lastTask = task;

    const activityLines: string[] = [];
    if (
      state.activity.kind !== "idle" ||
      toolViews.length > 0 ||
      agentViews.length > 0
    ) {
      const presentation = activityPresentation(
        state,
        activeTools.size,
        asyncSubagents.size,
        now,
        activityStartedAt,
        lastRelevantActivityAt,
      );
      const elapsed = Math.max(
        0,
        Math.floor((now - presentation.startedAt) / 1000),
      );
      const thinking =
        presentation.kind === "thinking"
          ? ` · ${thinkingLabel(state.model.thinking)}`
          : "";
      const glyph = activityGlyph(
        theme,
        ticker?.motion ?? "off",
        ticker?.frame ?? 0,
        presentation.kind,
      );
      const heading = theme.fg(
        presentation.kind === "thinking"
          ? thinkingTone(state.model.thinking)
          : presentation.kind === "waiting"
            ? "muted"
            : "accent",
        theme.bold(
          `${glyph ? `${glyph} ` : ""}${presentation.label}${thinking} · ${elapsed}s`,
        ),
      );
      const detailLimit =
        dashboardMode === "auto"
          ? layout === "compact"
            ? 0
            : 3
          : layout === "wide"
            ? 3
            : compact
              ? 0
              : 1;
      const visibleToolCount = Math.min(toolViews.length, detailLimit);
      const visibleAgentCount = Math.min(
        agentViews.length,
        Math.max(0, detailLimit - visibleToolCount),
      );
      // With exactly one running tool the heading already carries ARBEITET ·
      // Xs; repeating LÄUFT · Xs one row below is duplication, so the plain
      // running suffix is dropped (a stalled/error status still shows).
      const singleRunningTool =
        toolViews.length === 1 && state.activity.kind === "tool";
      activityLines.push(
        heading,
        ...renderActiveTools(
          toolViews.slice(0, visibleToolCount),
          theme,
          width - 4,
          now,
          {
            compact,
            wide: layout === "wide",
            limit: visibleToolCount,
            suppressRunningStatus: singleRunningTool,
          },
        ),
        ...renderSubagentBranches(
          task.subagents.slice(0, visibleAgentCount),
          theme,
          width - 4,
          visibleAgentCount,
        ),
      );
      const hiddenSummary = hiddenActivitySummary(
        toolViews.slice(visibleToolCount),
        agentViews.slice(visibleAgentCount),
        now,
      );
      if (
        visibleToolCount < toolViews.length ||
        visibleAgentCount < agentViews.length
      ) {
        activityLines.push(theme.fg("muted", hiddenSummary));
      }
    }

    if (dashboardMode === "auto") {
      const hasActiveWork =
        state.activity.kind !== "idle" ||
        activeTools.size > 0 ||
        agentViews.length > 0;
      const autoLines = renderAutoDashboard(task, theme, width, {
        activityLines,
        layout,
        hasActiveWork,
        verificationStale: verificationIsStale(
          activeTools,
          workspaceChangedSinceVerification,
        ),
        verificationKnown: lastVerificationStatus !== null,
      });
      auroraDiagnostics.recordDashboardRows(autoLines);
      return autoLines;
    }

    const maxRows =
      dashboardMode === "compact"
        ? 2
        : Math.min(
            layout === "wide"
              ? 14
              : layout === "comfortable"
                ? 11
                : Math.max(5, Math.min(8, rows - 10)),
            // Expanded keeps its richer panels but never eats the chat:
            // at most ~40% of terminal rows, always a few rows minimum.
            Math.max(4, Math.floor(rows * 0.4)),
          );
    const lines = renderDashboard(task, theme, width, {
      activityLines,
      maxRows,
      compact: dashboardMode === "compact" || layout === "compact",
    });
    auroraDiagnostics.recordDashboardRows(lines);
    return lines;
  }

  function mergeSubagents(): void {
    const byKey = new Map<string, SubagentInfo>();
    // Event-provided run ids keep simultaneous equal-named agents distinct.
    for (const entry of [
      ...[...asyncSubagents.values()].flat(),
      ...[...foregroundSubagents.values()].flat(),
    ]) {
      byKey.set(`${entry.runId ?? entry.agent}\u0000${entry.agent}`, entry);
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
    updateActivity(ctx, {
      kind: "tool",
    });
  }

  function applyWorking(ctx: ExtensionContext): void {
    if (!state || !ticker) return;
    const active = state.activity.kind !== "idle";
    ticker.setActivity(
      active,
      state.activity.kind === "thinking" || state.activity.kind === "tool",
    );

    // Aurora's activity widget is the single live-work surface. Keeping Pi's
    // native indicator visible as well creates a second moving signal next to
    // the editor; motion is rendered by the widget itself when enabled.
    ctx.ui.setWorkingVisible(false);
  }

  function updateState(
    ctx: ExtensionContext,
    patch: AuroraUiStatePatch,
  ): boolean {
    if (
      !state ||
      disposed ||
      ctx.sessionManager.getSessionId() !== activeSessionId
    )
      return false;
    const changed = mergeAuroraUiState(state, patch);
    if (!changed) return false;
    ticker?.requestRender();
    if (patch.activity) applyWorking(ctx);
    return true;
  }

  /** Update a real Activity state and its local display timing together. */
  function updateActivity(
    ctx: ExtensionContext,
    activity: NonNullable<AuroraUiStatePatch["activity"]>,
  ): void {
    const previousKind = state?.activity.kind;
    const nextKind = activity?.kind ?? previousKind;
    const now = Date.now();
    if (nextKind === "idle") {
      activityStartedAt = 0;
      lastRelevantActivityAt = 0;
    } else if (nextKind) {
      const wasWaiting =
        previousKind !== "tool" &&
        activeTools.size === 0 &&
        asyncSubagents.size === 0 &&
        lastRelevantActivityAt > 0 &&
        now - lastRelevantActivityAt >= WAITING_THRESHOLD_MS;
      if (previousKind !== nextKind || activityStartedAt === 0 || wasWaiting)
        activityStartedAt = now;
      lastRelevantActivityAt = now;
    }
    if (!updateState(ctx, { activity })) ticker?.requestRender();
  }

  /** A concrete event replaces a derived WARTET label without adding a state. */
  function noteRelevantActivity(): void {
    if (!state || state.activity.kind === "idle") return;
    const now = Date.now();
    if (
      state.activity.kind !== "tool" &&
      activeTools.size === 0 &&
      asyncSubagents.size === 0 &&
      lastRelevantActivityAt > 0 &&
      now - lastRelevantActivityAt >= WAITING_THRESHOLD_MS
    )
      activityStartedAt = now;
    lastRelevantActivityAt = now;
    ticker?.requestRender();
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
        if ("verification" in value.patch)
          workspaceChangedSinceVerification = false;
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
        if ("verification" in value.state)
          workspaceChangedSinceVerification = false;
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
          updateActivity(ctx, {
            kind: turnSettledWhileAsync ? "idle" : "responding",
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
    receiptAggregator.reset();
    activityStartedAt = 0;
    lastRelevantActivityAt = 0;
    turnSettledWhileAsync = false;
    currentUserPrompt = undefined;
    currentPlanText = undefined;
    lastVerificationStatus = null;
    workspaceChangedSinceVerification = false;
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

  registerInspectorCommand(pi, {
    getState: () => state,
    getTask: () => lastTask,
  });

  // Dashboard mode lives in exactly one place (ui.dashboard in setup.json,
  // schema-validated) and is reached through the existing command system —
  // the Super+Q Command Center lists /dashboard; no new shortcut exists.
  pi.registerCommand("dashboard", {
    description: catalogDescription("dashboard"),
    handler: async (args, ctx) => {
      const modes: DashboardMode[] = ["auto", "compact", "expanded", "hidden"];
      const requested = args.trim().toLowerCase();
      let next = modes.find((mode) => mode === requested);
      if (!next) {
        next = await runMenu(
          ctx,
          "Dashboard-Modus",
          modes.map((mode) => ({
            id: `dashboard-${mode}`,
            label: mode,
            current: mode === dashboardMode,
            value: mode,
          })),
        );
        if (!next) return;
      }
      try {
        await persistUiPreference({ dashboard: next });
      } catch (error) {
        ctx.ui.notify(
          `Dashboard-Modus konnte nicht gespeichert werden: ${
            error instanceof Error ? error.message : String(error)
          }`,
          "error",
        );
        return;
      }
      dashboardMode = next;
      ticker?.requestRender();
    },
  });

  pi.on("session_start", (_event, ctx) => {
    disposeSession(activeContext);
    receiptAggregator.reset();
    if (ctx.mode !== "tui" || !ctx.hasUI) return;

    const loaded = loadSetupConfig(ctx.cwd, ctx.isProjectTrusted());
    dashboardMode = loaded.config.ui.dashboard;
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

    // Aurora owns the footer and the activity widget. The editor stays Pi's
    // own component: subclassing it only to draw rails meant duplicating
    // editor settings and depending on core editor internals for decoration.

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
          const statuses = footerData.getExtensionStatuses();
          lastVerificationStatus = statuses.get("verification") ?? null;
          return renderFooterLines(theme, width, {
            state,
            statuses,
            contextPercent: sessionCtx.getContextUsage()?.percent ?? null,
            cwd: sessionCwd,
            homeDirectory: sessionHome,
            // One shared rule decides whether a visible dashboard surface owns
            // the routine verification report; the footer stays the escalation
            // surface for risks either way.
            dashboardVisible: dashboardOwnsVerification(
              dashboardMode,
              width,
              tui.terminal?.rows ?? 24,
              state.activity.kind !== "idle" || activeTools.size > 0,
            ),
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
            frames: [
              activityGlyph(ctx.ui.theme, loaded.config.ui.motion, 0, "tool"),
            ],
          },
    );
    installBus(ctx);
  });

  pi.on("before_agent_start", (event) => {
    currentUserPrompt = event.prompt;
    showStartscreen = false;
    ticker?.requestRender();
  });

  pi.on("agent_start", (_event, ctx) => {
    showStartscreen = false;
    turnSettledWhileAsync = false;
    activeTools.clear();
    foregroundSubagents.clear();
    refreshSubagentDisplay();
    updateActivity(ctx, {
      kind: "thinking",
    });
  });

  pi.on("tool_execution_start", (event, ctx) => {
    const startedAt = Date.now();
    receiptAggregator.recordStart(
      event.toolCallId,
      event.toolName,
      event.args,
      startedAt,
    );
    activeTools.set(event.toolCallId, {
      id: event.toolCallId,
      name: event.toolName,
      ...describeToolActivity(event.toolName, event.args, ctx.cwd),
      startedAt,
      lastUpdateAt: startedAt,
    });
    if (event.toolName === "subagent") {
      const subagents = foregroundSubagentsFromArgs(
        event.args,
        event.toolCallId,
      );
      if (subagents.length > 0)
        foregroundSubagents.set(event.toolCallId, subagents);
      refreshSubagentDisplay();
    }
    updateActivity(ctx, {
      kind: "tool",
    });
  });

  pi.on("tool_execution_update", (event) => {
    const tool = activeTools.get(event.toolCallId);
    if (tool) tool.lastUpdateAt = Date.now();
    const partial = record(event.partialResult);
    if (partial?.isError !== true) return;
    if (!tool || tool.tone === "error") return;
    tool.tone = "error";
    noteRelevantActivity();
  });

  pi.on("tool_execution_end", (event, ctx) => {
    activeTools.delete(event.toolCallId);
    receiptAggregator.recordEnd(
      event.toolCallId,
      event.result,
      event.isError,
      Date.now(),
    );
    if (
      !event.isError &&
      (event.toolName === "edit" || event.toolName === "write")
    ) {
      workspaceChangedSinceVerification = true;
    }
    if (event.toolName === "subagent") {
      foregroundSubagents.delete(event.toolCallId);
      refreshSubagentDisplay();
    }
    updateActivity(
      ctx,
      activeTools.size > 0
        ? {
            kind: "tool",
          }
        : asyncSubagents.size > 0
          ? {
              kind: "tool",
            }
          : {
              kind: "responding",
            },
    );
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
    // Text is still part of the active turn. Only agent_settled may clear this
    // surface; a first text_delta must never erase it.
    updateActivity(ctx, {
      kind: "responding",
    });
  });

  pi.on("model_select", (event, ctx) => {
    updateState(ctx, { model: { id: event.model.id } });
  });

  pi.on("thinking_level_select", (event, ctx) => {
    updateState(ctx, { model: { thinking: String(event.level) } });
    noteRelevantActivity();
  });

  // Pi 0.84.1 emits agent_end after each individual agent loop. Retry,
  // compaction, and queued continuations can all start another loop after it;
  // agent_settled is the sole terminal lifecycle event for Aurora.
  pi.on("agent_settled", (_event, ctx) => {
    turnSettledWhileAsync = true;
    activeTools.clear();
    foregroundSubagents.clear();
    refreshSubagentDisplay();
    if (sessionCwd && state && isPlanningMode(state.workflow.phase)) {
      currentPlanText = readPlan(sessionCwd);
    }
    if (asyncSubagents.size > 0) {
      retainAsyncActivity(ctx);
      return;
    }
    updateActivity(ctx, { kind: "idle" });
  });
  pi.on("session_shutdown", (_event, ctx) => disposeSession(ctx));
}
