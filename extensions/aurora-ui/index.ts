import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import type {
  ExtensionAPI,
  ExtensionContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { LAYOUT_COLUMNS, layoutForSize } from "../shared/layout.ts";
import { isPlanningMode } from "../shared/workflow-mode.ts";
import { planLocation, readPlan } from "../plan-mode/plan-store.ts";
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
  dashboardTileWidth,
  describeToolActivity,
  hiddenActivitySummary,
  renderActiveTools,
  renderRecentTools,
  renderDashboard,
  renderSubagentBranches,
  temporaryAgentDisplay,
  type ActiveToolView,
  type SubagentInfo,
} from "./tool-renderers.ts";
import { renderFooterLines } from "./footer.ts";
import { renderStartscreen } from "./startscreen.ts";
import { thinkingLabel } from "./thinking.ts";
import {
  renderVisualGlyph,
  visualStateForActivity,
  visualTone,
} from "./visual-state.ts";
import {
  sessionStatus,
  type HeaderActivity,
  type SessionStatus,
} from "./header.ts";
import { ReceiptAggregator } from "./receipts.ts";
import { auroraDiagnostics } from "./dev-diagnostics.ts";
import { projectTaskViewModel } from "./task-projection.ts";
import type { TaskViewModel } from "./task-view-model.ts";
import { registerInspectorCommand } from "./inspector-command.ts";
import { detailLimitFor, selectActivitySlots } from "./dashboard-budget.ts";
import {
  initialTurnLifecycle,
  lastAssistantStop,
  turnLifecycleOnAgentEnd,
  turnLifecycleOnAgentStart,
  turnLifecycleOnSettled,
  type TurnLifecycleState,
} from "./turn-lifecycle.ts";
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
} from "./tool-renderers.ts";

const OWNER = "aurora-ui";
const ACTIVITY_WIDGET = "aurora-ui/activity";
const TICK_INTERVAL_MS = 100;
const STATUS_TICK_INTERVAL_MS = 1_000;
/** A running turn without a concrete Aurora event is presented as WARTET AUF MODELL. */
const WAITING_THRESHOLD_MS = 4_000;
const FORGE_THEME_PATH = fileURLToPath(
  new URL("../../themes/aurora-forge.json", import.meta.url),
);
const THEME_PATH = fileURLToPath(
  new URL("../../themes/aurora-night.json", import.meta.url),
);
const DAY_THEME_PATH = fileURLToPath(
  new URL("../../themes/aurora-day.json", import.meta.url),
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
  spec?: unknown;
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
  const temporary = temporaryAgentDisplay(input.spec);
  if (temporary) {
    return [{ ...temporary, runId, status: "running" }];
  }
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
    task: { title: "Aktuelle Aufgabe", phaseLabel: "Bereit" },
    subagents: [],
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
      ? (this.motion === "expressive" ||
          (this.motion === "contextual" && animate))
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

type DisplayActivityKind =
  | "thinking"
  | "tool"
  | "responding"
  | "waiting"
  | "verifying";

function activityPresentation(
  state: AuroraUiState,
  activeTools: number,
  activeAsyncRuns: number,
  activeVerification: boolean,
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
  if (activeTools > 0) {
    return activeVerification
      ? { kind: "verifying", startedAt: activityStartedAt, label: "PRÜFT" }
      : { kind: "tool", startedAt: activityStartedAt, label: "ARBEITET" };
  }
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
 * Forge assigns movement by meaning: fast work, a slower waiting pulse,
 * a quiet response stream and a separate verification cadence. The shared
 * ticker remains the only clock; reduced/off collapse these profiles to static
 * or text-only output.
 */
function activityGlyph(
  theme: Theme,
  motion: MotionMode,
  frame: number,
  kind: DisplayActivityKind,
): string {
  return renderVisualGlyph(
    theme,
    visualStateForActivity(kind),
    motion,
    frame,
  );
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
  const recentActivityTools: Array<ActiveToolView & { completedAt: number }> =
    [];
  const RECENT_ACTIVITY_LIMIT = 3;
  const RECENT_ACTIVITY_TTL_MS = 20_000;
  let recentActivityExpiryTimer: ReturnType<typeof setTimeout> | undefined;
  let turnLifecycle: TurnLifecycleState = initialTurnLifecycle();
  // The last real width a widget/footer frame was asked to render at. The
  // /inspect command handler gets no width of its own from Pi's UI context,
  // unlike the per-frame surfaces, so it reuses this instead of a fixed 76.
  let lastKnownWidth: number = LAYOUT_COLUMNS.standard;
  const receiptAggregator = new ReceiptAggregator();
  // Presentation-only timestamps: neither is published nor part of Aurora's
  // activity-state contract.
  let activityStartedAt = 0;
  let lastRelevantActivityAt = 0;
  // This records only that Pi has emitted a real turn-completion event while
  // an async child remains visible; it does not introduce another activity
  // state or lifecycle source.
  let turnSettledWhileAsync = false;
  // Flashes the activity tile's badge once when it settles into a new
  // terminal status, since the ticker stops driving repaints once nothing
  // is live and would otherwise never clear the highlight on its own.
  const BADGE_HIGHLIGHT_MS = 600;
  let lastSettledStatus: SessionStatus | undefined;
  let badgeHighlightUntil = 0;
  let badgeHighlightTimer: ReturnType<typeof setTimeout> | undefined;

  function pruneRecentActivity(now: number): boolean {
    const firstLiveIndex = recentActivityTools.findIndex(
      (tool) => now - tool.completedAt < RECENT_ACTIVITY_TTL_MS,
    );
    if (firstLiveIndex === -1) {
      const changed = recentActivityTools.length > 0;
      recentActivityTools.length = 0;
      return changed;
    }
    if (firstLiveIndex === 0) return false;
    recentActivityTools.splice(0, firstLiveIndex);
    return true;
  }

  function scheduleRecentActivityExpiry(): void {
    clearTimeout(recentActivityExpiryTimer);
    recentActivityExpiryTimer = undefined;
    const first = recentActivityTools[0];
    if (!first) return;
    const delay = Math.max(
      0,
      first.completedAt + RECENT_ACTIVITY_TTL_MS - Date.now(),
    );
    recentActivityExpiryTimer = setTimeout(() => {
      recentActivityExpiryTimer = undefined;
      const changed = pruneRecentActivity(Date.now());
      if (changed) ticker?.requestRender();
      scheduleRecentActivityExpiry();
    }, delay);
  }

  function rememberCompletedActivity(tool: ActiveToolView): void {
    if (tool.kind !== "read" && tool.kind !== "bash") return;
    const completedAt = Date.now();
    pruneRecentActivity(completedAt);
    recentActivityTools.push({ ...tool, completedAt });
    if (recentActivityTools.length > RECENT_ACTIVITY_LIMIT) {
      recentActivityTools.splice(
        0,
        recentActivityTools.length - RECENT_ACTIVITY_LIMIT,
      );
    }
    scheduleRecentActivityExpiry();
  }

  function currentAgentViews(): SubagentInfo[] {
    if (fleetDockOwnsSubagents) return [];
    return [...subagentsCache].sort(
      (a, b) =>
        Number(b.status === "needs_attention") -
        Number(a.status === "needs_attention"),
    );
  }

  /**
   * The single task projection shared by the fixed panel, the workspace and
   * the inspector. Called eagerly from every event that changes state it
   * depends on (not just from rendering), so `lastTask` never goes stale
   * while dashboardMode is "hidden" or before the widget has ever painted.
   */
  function projectCurrentTask(now: number): TaskViewModel | undefined {
    if (!state) return undefined;
    // Task phase depends only on the structured frontend state. The formatted
    // footer label is presentation-only and may not have rendered at all.
    const task = projectTaskViewModel({
      state,
      activeTools,
      subagents: currentAgentViews(),
      receiptAggregator,
      now,
      verificationStatus: state.verification?.status,
      workspaceChangedSinceVerification,
      currentPlan: currentPlanText,
      userPrompt: currentUserPrompt,
      contextPercent: activeContext?.getContextUsage()?.percent ?? null,
    });
    lastTask = task;
    return task;
  }

  function currentHeaderActivity(now: number): {
    activity: HeaderActivity;
    elapsedSeconds?: number;
  } {
    if (!state) return { activity: "idle" };
    // The turn's own outcome (from real agent_end/stopReason signals) drives
    // the terminal states; a tool failure alone never reaches turnLifecycle,
    // so it cannot make a turn that ended cleanly show as failed.
    if (turnLifecycle.status === "failed") return { activity: "error" };
    if (turnLifecycle.status === "cancelled") return { activity: "cancelled" };
    if (
      turnLifecycle.status === "succeeded" &&
      state.activity.kind === "idle" &&
      activeTools.size === 0 &&
      asyncSubagents.size === 0
    ) {
      return { activity: "done" };
    }
    if (state.activity.kind === "idle") return { activity: "idle" };

    const presentation = activityPresentation(
      state,
      activeTools.size,
      asyncSubagents.size,
      [...activeTools.values()].some((tool) => tool.kind === "verification"),
      now,
      activityStartedAt,
      lastRelevantActivityAt,
    );
    const activity: HeaderActivity =
      presentation.kind === "thinking"
        ? "thinking"
        : presentation.kind === "tool"
          ? "running"
          : presentation.kind === "verifying"
            ? "verifying"
            : presentation.kind === "responding"
              ? "responding"
              : "waiting";
    return {
      activity,
      elapsedSeconds: Math.max(
        0,
        Math.floor((now - presentation.startedAt) / 1000),
      ),
    };
  }

  /**
   * The surface above the editor is a fresh-session welcome followed by the
   * fixed Session panel and adaptive tile workspace. It consumes cached runtime values only: rendering
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
    lastKnownWidth = width;
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
    const compact = layout === "compact" || dashboardMode === "compact";
    const now = Date.now();
    pruneRecentActivity(now);
    const toolViews = [...activeTools.values()];
    const agentViews = currentAgentViews();
    // A pure read, not a computation: every event that can change the task
    // projection already refreshes lastTask itself (see projectCurrentTask's
    // call sites above), so rendering never has to derive it — and never
    // risks the inspector seeing a different, independently re-derived task
    // than the one the dashboard just painted.
    const task = lastTask;
    if (!task) return [];

    const activityLines: string[] = [];
    let dashboardOverflowNote: string | undefined;
    const hasLiveActivity =
      state.activity.kind !== "idle" ||
      toolViews.length > 0 ||
      agentViews.length > 0;
    if (hasLiveActivity) {
      const presentation = activityPresentation(
        state,
        activeTools.size,
        asyncSubagents.size,
        [...activeTools.values()].some((tool) => tool.kind === "verification"),
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
      // A running subagent is background tool work — it shares the heading's
      // spinning cursor kind ("tool") instead of a static dot, so several
      // parallel agents don't read as frozen while only the heading moves.
      const workingGlyph = activityGlyph(
        theme,
        ticker?.motion ?? "off",
        ticker?.frame ?? 0,
        "tool",
      );
      const verificationGlyph = activityGlyph(
        theme,
        ticker?.motion ?? "off",
        ticker?.frame ?? 0,
        "verifying",
      );
      const heading = theme.fg(
        visualTone(visualStateForActivity(presentation.kind)),
        theme.bold(
          `${glyph ? `${glyph} ` : ""}${presentation.label}${thinking} · ${elapsed}s`,
        ),
      );
      // One shared priority order for tools and subagents — a
      // needs_attention subagent or a genuinely erroring/stalled tool always
      // gets a slot before a routine running tool, instead of tools always
      // claiming every slot first and subagents only getting the leftovers.
      const detailLimit = detailLimitFor(dashboardMode, layout);
      const slots = selectActivitySlots(toolViews, agentViews, detailLimit);
      // task.subagents (SubagentBranchInfo[]) is the same length and order as
      // agentViews (SubagentInfo[]) — both derive from the same
      // currentAgentViews() snapshot — so identity lookup maps a selected
      // SubagentInfo back to its rendered branch without re-deriving it.
      const visibleAgentSet = new Set(slots.visibleSubagents);
      const visibleBranches = task.subagents.filter((_branch, i) =>
        visibleAgentSet.has(agentViews[i]!),
      );
      // With exactly one running tool the heading already carries ARBEITET ·
      // Xs; repeating LÄUFT · Xs one row below is duplication, so the plain
      // running suffix is dropped (a stalled/error status still shows).
      const singleRunningTool =
        toolViews.length === 1 && state.activity.kind === "tool";
      const toolLines = renderActiveTools(
        slots.visibleTools,
        theme,
        dashboardTileWidth(width) - 4,
        now,
        {
          compact,
          wide: layout === "wide",
          limit: slots.visibleTools.length,
          suppressRunningStatus: singleRunningTool,
          activityGlyph: workingGlyph,
          verificationGlyph,
        },
      );
      const subagentLines = renderSubagentBranches(
        visibleBranches,
        theme,
        dashboardTileWidth(width) - 4,
        visibleBranches.length,
        workingGlyph,
      );
      // Row-budget trimming (selectDashboardContent) cuts from the end of
      // this list, so whichever block renders first survives longest. A
      // subagent asking for attention must outrank routine tool rows there
      // too, not only in which of them got a slot above — otherwise a tight
      // terminal could still cut the one thing the user actually needs to
      // see while ordinary tool rows survive.
      const attentionSubagent = slots.visibleSubagents.find(
        (subagent) => subagent.status === "needs_attention",
      );
      const attentionPending = attentionSubagent !== undefined;
      if (attentionSubagent) {
        dashboardOverflowNote = `⚠ ${attentionSubagent.agent} benötigt Aufmerksamkeit`;
      }
      const recentLines =
        recentActivityTools.length > 0
          ? renderRecentTools(
              recentActivityTools,
              theme,
              dashboardTileWidth(width) - 4,
              now,
              { compact, wide: layout === "wide" },
            )
          : [];
      activityLines.push(
        heading,
        ...(attentionPending
          ? [...subagentLines, ...toolLines]
          : [...toolLines, ...subagentLines]),
        ...recentLines,
      );
      const hiddenSummary = hiddenActivitySummary(
        slots.hiddenTools,
        slots.hiddenSubagents,
        now,
      );
      if (slots.hiddenTools.length > 0 || slots.hiddenSubagents.length > 0) {
        activityLines.push(theme.fg("muted", hiddenSummary));
      }
    }
    if (!hasLiveActivity && recentActivityTools.length > 0) {
      activityLines.push(
        ...renderRecentTools(
          recentActivityTools,
          theme,
          dashboardTileWidth(width) - 4,
          now,
          { compact: dashboardMode === "compact", wide: layout === "wide" },
        ),
      );
    }

    const baseMaxRows =
      dashboardMode === "compact"
        ? 2
        : Math.min(
            layout === "wide"
              ? 14
              : layout === "comfortable"
                ? 11
                : Math.max(5, Math.min(8, rows - 10)),
            Math.max(4, Math.floor(rows * 0.4)),
          );
    // Recent READ/BEFEHL history is optional context and must never enlarge
    // the hard terminal row budget. Live status and attention rows are ordered
    // ahead of this history before the renderer trims to maxRows.
    const maxRows = baseMaxRows;
    // Auto and expanded share the framed tile overview. Compact uses the flat
    // fallback, but retained history is allowed to use its reserved rows.
    // The overall run state — formerly the separate fixed Session panel —
    // now lives in the activity tile's own badge once nothing is live; while
    // something is running, the heading line already inside activityLines
    // carries the detailed status and its elapsed time.
    const headerActivity = currentHeaderActivity(now);
    const settledStatus =
      !hasLiveActivity && headerActivity.activity
        ? sessionStatus({ activity: headerActivity.activity, task })
        : undefined;
    if (
      settledStatus &&
      settledStatus !== "idle" &&
      settledStatus !== lastSettledStatus
    ) {
      badgeHighlightUntil = now + BADGE_HIGHLIGHT_MS;
      clearTimeout(badgeHighlightTimer);
      badgeHighlightTimer = setTimeout(
        () => ticker?.requestRender(),
        BADGE_HIGHLIGHT_MS,
      );
    }
    lastSettledStatus = settledStatus;
    const dashboardLines = renderDashboard(task, theme, width, {
      activityLines,
      maxRows,
      compact,
      liveActivity: hasLiveActivity,
      activity: headerActivity.activity,
      highlightBadge: now < badgeHighlightUntil,
      overflowNote: dashboardOverflowNote,
    });
    // A leading blank row separates the persistent dashboard from the
    // scrolling transcript above it; compact mode stays a hard two-row
    // fallback, so it keeps every row for content instead.
    const lines =
      compact || dashboardLines.length === 0
        ? dashboardLines
        : ["", ...dashboardLines];
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

    // Aurora's activity widget is the single live-work surface, so the
    // native indicator normally stays hidden to avoid a second moving signal
    // next to the editor. dashboardMode "hidden" removes that surface
    // entirely though, and must not also remove the only remaining sign that
    // work is still happening — it falls back to Pi's own indicator then.
    ctx.ui.setWorkingVisible(dashboardMode === "hidden" && active);
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
        projectCurrentTask(Date.now());
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
        projectCurrentTask(Date.now());
      }),
      pi.events.on("subagent:async-started", (value) => {
        if (disposed) return;
        const started = asyncSubagentsFromStart(value, activeSessionId);
        if (!started) return;
        asyncSubagents.set(started.runId, started.entries);
        refreshSubagentDisplay();
        retainAsyncActivity(ctx);
        projectCurrentTask(Date.now());
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
        projectCurrentTask(Date.now());
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
        projectCurrentTask(Date.now());
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
    recentActivityTools.length = 0;
    clearTimeout(recentActivityExpiryTimer);
    recentActivityExpiryTimer = undefined;
    turnLifecycle = initialTurnLifecycle();
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
    // A session boundary must not leak the previous session's task/
    // verification projection into the next one's inspector.
    lastTask = undefined;
    clearTimeout(badgeHighlightTimer);
    badgeHighlightTimer = undefined;
    lastSettledStatus = undefined;
    badgeHighlightUntil = 0;
    ticker?.dispose();
    ticker = undefined;

    const uiContext = ctx ?? activeContext;
    if (uiContext?.mode === "tui" && uiContext.hasUI) {
      uiContext.ui.setHeader(undefined);
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

  pi.on("resources_discover", () => ({
    themePaths: [FORGE_THEME_PATH, THEME_PATH, DAY_THEME_PATH],
  }));

  registerInspectorCommand(pi, {
    getState: () => state,
    getTask: () => lastTask,
    getWidth: () => lastKnownWidth,
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

    // Aurora owns fixed orientation/status chrome and the workspace widget. The
    // editor remains Pi's own component, preserving its input, scroll and
    // shortcut behaviour.

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
          lastKnownWidth = width;
          if (!state) return [];
          const statuses = footerData.getExtensionStatuses();
          const previousVerificationStatus = lastVerificationStatus;
          lastVerificationStatus = statuses.get("verification") ?? null;
          // getExtensionStatuses() is only reachable from this render
          // callback (Pi has no separate event for it), so this is the one
          // place a render legitimately triggers a projection refresh — only
          // when the footer's own status actually changed, not on every
          // frame.
          if (lastVerificationStatus !== previousVerificationStatus) {
            projectCurrentTask(Date.now());
          }
          return renderFooterLines(theme, width, {
            state,
            statuses,
            contextPercent: sessionCtx.getContextUsage()?.percent ?? null,
            cwd: sessionCwd,
            homeDirectory: sessionHome,
            // No dashboard tile shows verification any more (removed along
            // with PRÜFUNGEN); the footer is now the sole permanent surface
            // for routine and failed verification status alike.
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
    // Seed the projection immediately, so the inspector has a real task view
    // even before anything renders or any further event arrives.
    projectCurrentTask(Date.now());
  });

  pi.on("before_agent_start", (event) => {
    currentUserPrompt = event.prompt;
    // A plan is only a valid task-title source for the turn it belongs to.
    // A brand-new prompt that starts outside planning mode is a new,
    // independent task and must not keep showing a previous plan's title —
    // the plan itself stays on disk, only its use as the current title ends.
    if (!state || !isPlanningMode(state.workflow.phase)) {
      currentPlanText = undefined;
    }
    showStartscreen = false;
    projectCurrentTask(Date.now());
    ticker?.requestRender();
  });

  pi.on("agent_start", (_event, ctx) => {
    showStartscreen = false;
    turnSettledWhileAsync = false;
    turnLifecycle = turnLifecycleOnAgentStart();
    activeTools.clear();
    foregroundSubagents.clear();
    refreshSubagentDisplay();
    // Projects only after the activity kind has actually switched to
    // "thinking" below — projecting first would still read the pre-turn
    // "idle" kind and freeze the task phase one step behind.
    updateActivity(ctx, {
      kind: "thinking",
    });
    projectCurrentTask(Date.now());
  });

  // agent_end can fire more than once per turn (retry, compaction, a queued
  // continuation each start another agent_start/agent_end pair); only the
  // *last* one before agent_settled describes the turn's real outcome, which
  // is exactly what turnLifecycleOnAgentEnd's overwrite-on-each-call does.
  pi.on("agent_end", (event) => {
    const { stopReason } = lastAssistantStop(event.messages);
    turnLifecycle = turnLifecycleOnAgentEnd(turnLifecycle, stopReason);
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
    // See agent_start: project after the activity kind actually flips to
    // "tool", not before.
    updateActivity(ctx, {
      kind: "tool",
    });
    projectCurrentTask(Date.now());
  });

  pi.on("tool_execution_update", (event) => {
    const tool = activeTools.get(event.toolCallId);
    if (tool) tool.lastUpdateAt = Date.now();
    const partial = record(event.partialResult);
    if (partial?.isError !== true) return;
    if (!tool || tool.tone === "error") return;
    // A tool failure is a live-activity signal (the row's own error tone,
    // still visible in the Inspector/receipts) — it must never by itself
    // decide the turn's final outcome; only a real agent_end stopReason does.
    tool.tone = "error";
    projectCurrentTask(Date.now());
    noteRelevantActivity();
  });

  pi.on("tool_execution_end", (event, ctx) => {
    const completedTool = activeTools.get(event.toolCallId);
    if (completedTool) rememberCompletedActivity(completedTool);
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
    // See agent_start: project after updateActivity below has settled the
    // real next activity kind, not before.
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
    projectCurrentTask(Date.now());
  });

  pi.on("message_update", (event, ctx) => {
    if (!event.assistantMessageEvent.type.startsWith("text_")) return;
    activeTools.clear();
    foregroundSubagents.clear();
    refreshSubagentDisplay();
    if (asyncSubagents.size > 0) {
      retainAsyncActivity(ctx);
      projectCurrentTask(Date.now());
      return;
    }
    // Text is still part of the active turn. Only agent_settled may clear this
    // surface; a first text_delta must never erase it.
    updateActivity(ctx, {
      kind: "responding",
    });
    projectCurrentTask(Date.now());
  });

  pi.on("model_select", (event, ctx) => {
    updateState(ctx, { model: { id: event.model.id } });
    projectCurrentTask(Date.now());
  });

  pi.on("thinking_level_select", (event, ctx) => {
    updateState(ctx, { model: { thinking: String(event.level) } });
    projectCurrentTask(Date.now());
    noteRelevantActivity();
  });

  // Pi 0.84.1 emits agent_end after each individual agent loop. Retry,
  // compaction, and queued continuations can all start another loop after it;
  // agent_settled is the sole terminal lifecycle event for Aurora, but the
  // turn's actual outcome was already decided by the *last* agent_end before
  // it — settling only finalizes whatever turnLifecycle already holds.
  pi.on("agent_settled", (_event, ctx) => {
    turnSettledWhileAsync = true;
    turnLifecycle = turnLifecycleOnSettled(turnLifecycle);
    activeTools.clear();
    foregroundSubagents.clear();
    refreshSubagentDisplay();
    if (sessionCwd && state && isPlanningMode(state.workflow.phase)) {
      // Plans are session-scoped now, so the display needs the session id as
      // well as the workspace — reading "the" plan of a directory would show a
      // concurrent session's plan.
      currentPlanText = readPlan(
        planLocation(sessionCwd, ctx.sessionManager.getSessionId()),
      )?.content;
    }
    // See agent_start: project after the activity kind has settled to its
    // post-turn value (idle, or "tool" again if an async child retains it),
    // not before — otherwise the projection still reflects the turn's last
    // live activity kind instead of its actual settled outcome.
    if (asyncSubagents.size > 0) {
      retainAsyncActivity(ctx);
      projectCurrentTask(Date.now());
      return;
    }
    updateActivity(ctx, { kind: "idle" });
    projectCurrentTask(Date.now());
  });
  pi.on("session_shutdown", (_event, ctx) => disposeSession(ctx));
}
