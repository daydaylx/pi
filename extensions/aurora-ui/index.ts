import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
  CustomEditor,
  type ExtensionAPI,
  type ExtensionContext,
  type KeybindingsManager,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import {
  type EditorTheme,
  type TUI,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import {
  loadSetupConfig,
  type MotionMode,
} from "../setup-core/config.ts";
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
  type ActiveToolView,
} from "./tool-renderers.ts";

const OWNER = "aurora-ui";
const ACTIVITY_WIDGET = "aurora-ui/activity";
const TICK_INTERVAL_MS = 100;
const THEME_PATH = fileURLToPath(
  new URL("../../themes/aurora-night.json", import.meta.url),
);

type Layout = "narrow" | "normal" | "wide";

function layoutFor(width: number): Layout {
  if (width < 72) return "narrow";
  if (width < 120) return "normal";
  return "wide";
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
    workflow: { phase: "idle", label: "WORK" },
    permissions: {},
    lsp: {},
    model: {
      id: ctx.model?.id,
      thinking: String(pi.getThinkingLevel()),
    },
    activity: { kind: "idle", activeTools: 0 },
  };
}

function crop(value: string, width: number): string {
  return truncateToWidth(value, Math.max(1, width), "…");
}

function renderBar(
  theme: Theme,
  content: string,
  width: number,
  edge: "top" | "bottom",
  active: boolean,
): string {
  if (width <= 2) return crop(content, width);
  const color = active ? "borderAccent" : "borderMuted";
  const left = edge === "top" ? "╭─" : "╰─";
  const right = edge === "top" ? "╮" : "╯";
  const inner = crop(` ${content} `, Math.max(1, width - 3));
  const fill = "─".repeat(
    Math.max(0, width - visibleWidth(left) - visibleWidth(inner) - visibleWidth(right)),
  );
  return crop(
    theme.fg(color, left) + inner + theme.fg(color, fill + right),
    width,
  );
}

function joinSides(left: string, right: string, width: number): string {
  const available = Math.max(1, width);
  if (visibleWidth(left) + visibleWidth(right) + 1 > available) {
    if (available < 52) return crop(`${left} · ${right}`, available);
    const leftWidth = Math.max(1, Math.floor(available * 0.55));
    const clippedLeft = crop(left, leftWidth);
    return crop(
      clippedLeft +
        " ".repeat(
          Math.max(1, available - visibleWidth(clippedLeft) - visibleWidth(right)),
        ) +
        right,
      available,
    );
  }
  return (
    left +
    " ".repeat(Math.max(1, available - visibleWidth(left) - visibleWidth(right))) +
    right
  );
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

class AuroraEditor extends CustomEditor {
  private readonly detachTicker: () => void;

  constructor(
    tui: TUI,
    editorTheme: EditorTheme,
    keybindings: KeybindingsManager,
    private readonly auroraTheme: Theme,
    private readonly auroraState: AuroraUiState,
    private readonly ticker: AnimationTicker,
    private readonly readContextPercent: () => number | null,
  ) {
    super(tui, editorTheme, keybindings);
    this.detachTicker = ticker.attach(tui);
  }

  dispose(): void {
    this.detachTicker();
  }

  render(width: number): string[] {
    const layout = layoutFor(width);
    const workflow = this.auroraState.workflow;
    const step = workflow.step ? crop(workflow.step, layout === "wide" ? 54 : 28) : "—";
    const model = this.auroraState.model.id ?? "no model";
    const thinking = this.auroraState.model.thinking ?? "off";
    const contextPercent = this.readContextPercent();
    const context = contextPercent === null ? "ctx —" : `ctx ${contextPercent.toFixed(0)}%`;
    const active = this.auroraState.activity.kind !== "idle";

    let top: string;
    let bottom: string;
    if (layout === "narrow") {
      top = `AURORA · ${workflow.label}`;
      bottom = `${crop(model, 24)} · ${context}`;
    } else if (layout === "normal") {
      top = `AURORA NIGHT · ${workflow.label} · ${step}`;
      bottom = `${crop(model, 38)} · think ${thinking} · ${context}`;
    } else {
      top = `AURORA NIGHT · WORKFLOW ${workflow.label} · STEP ${step}`;
      bottom = `MODEL ${crop(model, 48)} · THINK ${thinking} · CONTEXT ${contextPercent === null ? "—" : `${contextPercent.toFixed(1)}%`}`;
    }

    const pulse =
      active && this.ticker.motion === "contextual" && this.ticker.frame % 8 < 4;
    return [
      renderBar(this.auroraTheme, top, width, "top", pulse),
      ...super.render(width),
      renderBar(this.auroraTheme, bottom, width, "bottom", active),
    ];
  }
}

function formatTokens(value: number): string {
  if (value < 1_000) return String(value);
  if (value < 1_000_000) return `${(value / 1_000).toFixed(1)}k`;
  return `${(value / 1_000_000).toFixed(1)}m`;
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
  let tokenTotalsCacheKey: string | undefined;
  let tokenTotalsCache = { input: 0, output: 0 };
  const activeTools = new Map<string, ActiveToolView>();

  function readAssistantTotals(ctx: ExtensionContext): {
    input: number;
    output: number;
  } {
    const branch = ctx.sessionManager.getBranch();
    const cacheKey = `${ctx.sessionManager.getLeafId() ?? "root"}:${branch.length}`;
    if (cacheKey === tokenTotalsCacheKey) return tokenTotalsCache;
    let input = 0;
    let output = 0;
    for (const entry of branch) {
      if (entry.type !== "message" || entry.message.role !== "assistant") continue;
      const message = entry.message as AssistantMessage;
      input += message.usage.input;
      output += message.usage.output;
    }
    tokenTotalsCacheKey = cacheKey;
    tokenTotalsCache = { input, output };
    return tokenTotalsCache;
  }

  function renderActivityWidget(theme: Theme, width: number): string[] {
    if (!state || state.activity.kind === "idle") return [];
    const icon = workingFrame(theme, ticker?.motion ?? "off", ticker?.frame ?? 0);
    const label = state.activity.label ?? "Arbeite …";
    const heading = crop(
      `${icon ? `${icon} ` : ""}${theme.fg("muted", label)}`,
      width,
    );
    const tools = renderActiveTools(
      [...activeTools.values()],
      theme,
      Math.max(1, width - 2),
      Date.now(),
    ).map((line) => `  ${line}`);
    return [heading, ...tools];
  }

  function applyWorking(ctx: ExtensionContext): void {
    if (!state || !ticker) return;
    const active = state.activity.kind !== "idle";
    ticker.setAnimationActive(active);

    if (!active) {
      ctx.ui.setWorkingVisible(false);
      return;
    }
    if (ticker.motion === "off") {
      ctx.ui.setWorkingIndicator({ frames: [] });
      ctx.ui.setWorkingVisible(false);
      return;
    }
    ctx.ui.setWorkingIndicator({
      frames: [workingFrame(ctx.ui.theme, ticker.motion, ticker.frame)],
    });
    ctx.ui.setWorkingMessage(state.activity.label ?? "Arbeite …");
    ctx.ui.setWorkingVisible(true);
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
    tokenTotalsCacheKey = undefined;
    tokenTotalsCache = { input: 0, output: 0 };
    ticker?.dispose();
    ticker = undefined;

    const uiContext = ctx ?? activeContext;
    if (uiContext?.mode === "tui" && uiContext.hasUI) {
      uiContext.ui.setEditorComponent(undefined);
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
    const epoch = makeEpoch(++epochSequence);
    state = makeState(epoch, ctx, pi);
    state.permissions.label = `PERM ${loaded.config.permissions.bash.toUpperCase()}`;
    state.lsp.state = loaded.config.lsp.enabled ? "idle" : "off";
    activeContext = ctx;
    activeSessionId = ctx.sessionManager.getSessionId();
    disposed = false;

    previousTheme = ctx.ui.theme.name;
    selectedTheme = loaded.config.ui.theme;
    const themeResult = ctx.ui.setTheme(selectedTheme);
    if (!themeResult.success) {
      ctx.ui.notify(`Aurora theme: ${themeResult.error ?? "nicht verfügbar"}`, "warning");
    }

    ticker = new AnimationTicker(loaded.config.ui.motion, (frame) => {
      if (!state || disposed || !activeContext || !ticker) return;
      if (state.activity.kind !== "idle" && ticker.motion !== "off") {
        activeContext.ui.setWorkingIndicator({
          frames: [workingFrame(activeContext.ui.theme, ticker.motion, frame)],
        });
      }
    });

    const sessionCtx = ctx;
    ctx.ui.setEditorComponent((tui, editorTheme, keybindings) =>
      new AuroraEditor(
        tui,
        editorTheme,
        keybindings,
        sessionCtx.ui.theme,
        state!,
        ticker!,
        () => sessionCtx.getContextUsage()?.percent ?? null,
      ),
    );

    ctx.ui.setFooter((tui, theme, footerData) => {
      const detachTicker = ticker!.attach(tui);
      const unsubscribeBranch = footerData.onBranchChange(() => tui.requestRender());
      return {
        invalidate() {},
        dispose() {
          unsubscribeBranch();
          detachTicker();
        },
        render(width: number): string[] {
          if (!state) return [];
          const layout = layoutFor(width);
          const statuses = footerData.getExtensionStatuses();
          const branch = footerData.getGitBranch();
          const project = basename(sessionCtx.cwd) || sessionCtx.cwd;
          const workflow = statuses.get("workflow") ?? state.workflow.label;
          const permission =
            statuses.get("permissions") ?? state.permissions.label ?? "PERM —";
          const lsp = statuses.get("lsp") ?? state.lsp.state ?? "—";
          const left =
            layout === "wide"
              ? `${theme.fg("accent", project)}${branch ? theme.fg("muted", ` · git ${branch}`) : ""}`
              : `${theme.fg("accent", crop(project, 28))}${branch ? theme.fg("muted", ` · ${crop(branch, 18)}`) : ""}`;
          const right = `${theme.fg("muted", workflow)} · ${theme.fg("warning", permission)} · ${theme.fg(lsp === "degraded" ? "error" : "success", `LSP ${lsp}`)}`;
          const lines = [joinSides(left, right, width)];
          if (layout === "wide") {
            const totals = readAssistantTotals(sessionCtx);
            lines.push(
              theme.fg(
                "dim",
                `session ${pi.getSessionName() ?? "unnamed"} · ↑${formatTokens(totals.input)} ↓${formatTokens(totals.output)}`,
              ),
            );
          }
          return lines.map((line) => crop(line, width));
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
          render: (width: number) => renderActivityWidget(theme, width),
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

  pi.on("agent_start", (_event, ctx) => {
    activeTools.clear();
    updateState(ctx, {
      activity: {
        kind: "thinking",
        label: "Analysiert die Aufgabe …",
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
              label: "Bereitet die Antwort vor …",
              activeTools: 0,
            },
    });
  });

  pi.on("message_update", (event, ctx) => {
    if (!event.assistantMessageEvent.type.startsWith("text_")) return;
    activeTools.clear();
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
    updateState(ctx, {
      activity: { kind: "idle", label: undefined, activeTools: 0 },
    });
  };
  pi.on("agent_end", settle);
  pi.on("agent_settled", settle);
  pi.on("session_shutdown", (_event, ctx) => disposeSession(ctx));
}
