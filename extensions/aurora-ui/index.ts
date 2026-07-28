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
  visibleWidth,
} from "@earendil-works/pi-tui";
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
  type ActiveToolView,
} from "./tool-renderers.ts";
import { crop, layoutFor } from "./layout.ts";
import { renderFooterLines } from "./footer.ts";

const OWNER = "aurora-ui";
const ACTIVITY_WIDGET = "aurora-ui/activity";
const TICK_INTERVAL_MS = 100;
const THEME_PATH = fileURLToPath(
  new URL("../../themes/aurora-night.json", import.meta.url),
);

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
    workflow: { phase: "idle", label: "ARBEIT" },
    permissions: {},
    lsp: {},
    model: {
      id: ctx.model?.id,
      thinking: String(pi.getThinkingLevel()),
    },
    activity: { kind: "idle", activeTools: 0 },
  };
}

/**
 * The single frame line above the editor. It carries the workflow and the
 * current step only — everything durable (model, thinking, project, context)
 * lives in the footer, so no value is shown on two surfaces at once.
 */
function renderBar(
  theme: Theme,
  content: string,
  width: number,
  active: boolean,
): string {
  if (width <= 2) return crop(content, width);
  const color = active ? "borderAccent" : "borderMuted";
  const left = "╭─";
  const right = "╮";
  const inner = crop(` ${content} `, Math.max(1, width - 3));
  const fill = "─".repeat(
    Math.max(
      0,
      width - visibleWidth(left) - visibleWidth(inner) - visibleWidth(right),
    ),
  );
  return crop(
    theme.fg(color, left) + inner + theme.fg(color, fill + right),
    width,
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
    ticker: AnimationTicker,
  ) {
    super(tui, editorTheme, keybindings);
    this.detachTicker = ticker.attach(tui);
  }

  dispose(): void {
    this.detachTicker();
  }

  render(width: number): string[] {
    const workflow = this.auroraState.workflow;
    const step = workflow.step
      ? crop(workflow.step, layoutFor(width) === "wide" ? 54 : 28)
      : "—";
    const active = this.auroraState.activity.kind !== "idle";
    return [
      renderBar(
        this.auroraTheme,
        `${workflow.label} · Schritt ${step}`,
        width,
        active,
      ),
      ...super.render(width),
    ];
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
  let tokenTotalsDirty = true;
  let tokenTotalsCache = { input: 0, output: 0 };
  const activeTools = new Map<string, ActiveToolView>();

  function readAssistantTotals(ctx: ExtensionContext): {
    input: number;
    output: number;
  } {
    if (!tokenTotalsDirty) return tokenTotalsCache;
    const branch = ctx.sessionManager.getBranch();
    let input = 0;
    let output = 0;
    for (const entry of branch) {
      if (entry.type !== "message" || entry.message.role !== "assistant")
        continue;
      const message = entry.message as AssistantMessage;
      input += message.usage.input;
      output += message.usage.output;
    }
    tokenTotalsCache = { input, output };
    tokenTotalsDirty = false;
    return tokenTotalsCache;
  }

  function renderActivityWidget(theme: Theme, width: number): string[] {
    if (!state || state.activity.kind === "idle") return [];
    const icon = workingFrame(
      theme,
      ticker?.motion ?? "off",
      ticker?.frame ?? 0,
    );
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
    tokenTotalsDirty = true;
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

    ticker = new AnimationTicker(loaded.config.ui.motion, (frame) => {
      if (!state || disposed || !activeContext || !ticker) return;
      if (state.activity.kind !== "idle" && ticker.motion !== "off") {
        activeContext.ui.setWorkingIndicator({
          frames: [workingFrame(activeContext.ui.theme, ticker.motion, frame)],
        });
      }
    });

    const sessionCtx = ctx;
    ctx.ui.setEditorComponent(
      (tui, editorTheme, keybindings) =>
        new AuroraEditor(
          tui,
          editorTheme,
          keybindings,
          sessionCtx.ui.theme,
          state!,
          ticker!,
        ),
    );

    ctx.ui.setFooter((tui, theme, footerData) => {
      const detachTicker = ticker!.attach(tui);
      const unsubscribeBranch = footerData.onBranchChange(() => {
        tokenTotalsDirty = true;
        tui.requestRender();
      });
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
            branch: footerData.getGitBranch(),
            cwd: sessionCtx.cwd,
            sessionName: pi.getSessionName(),
            tokens: readAssistantTotals(sessionCtx),
            contextPercent: sessionCtx.getContextUsage()?.percent ?? null,
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
