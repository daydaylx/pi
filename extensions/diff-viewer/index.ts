/** Verbesserte, session-basierte Diff-Darstellung für edit/write-Operationen. */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { Text } from "@earendil-works/pi-tui";
import { catalogDescription } from "../shared/command-catalog.ts";
import { toWorkspaceRelative } from "../shared/paths.ts";
import {
  FRONTEND_UI_CHANNELS,
  isFrontendUiStateRequest,
  publishFrontendUiPatch,
  publishFrontendUiSnapshot,
  type FrontendTaskChanges,
} from "../frontend-protocol/state-bus.ts";
import type { DiffViewEntryData } from "./types.ts";
import { ChangeTracker } from "./change-tracker.ts";
import { computeFallbackDiff } from "./git-diff.ts";
import { renderCompact } from "./diff-renderer.ts";
import { DiffBrowserComponent } from "./diff-browser.ts";
import { DiffEntryComponent } from "./diff-entry.ts";

const LIVE_PREVIEW_WIDGET = "diff-viewer/live-preview";

interface PendingDiff {
  path: string;
  oldContent: string;
  expectedContent: string;
  timestamp: number;
  preview?: DiffViewEntryData;
}

async function readCurrentFile(
  cwd: string,
  filePath: string,
): Promise<string | null> {
  try {
    return await readFile(resolve(cwd, filePath), "utf8");
  } catch {
    return null;
  }
}

function summarizeChanges(tracker: ChangeTracker): FrontendTaskChanges {
  const changes = tracker.changedFiles;
  let linesAdded = 0;
  let linesRemoved = 0;
  for (const change of changes) {
    linesAdded += change.stats.linesAdded;
    linesRemoved += change.stats.linesRemoved;
  }
  return {
    filesCount: changes.length,
    files: changes.map((change) => change.path),
    linesAdded,
    linesRemoved,
  };
}

export default function diffViewerExtension(pi: ExtensionAPI): void {
  const tracker = new ChangeTracker();
  const pendingDiffs = new Map<string, PendingDiff>();
  const livePreviews = new Map<string, DiffViewEntryData>();
  let activeCtx: ExtensionContext | null = null;
  let auroraEpoch: string | undefined;
  let unsubscribeAurora: (() => void) | undefined;

  function auroraChangesState(): FrontendTaskChanges | null {
    const summary = summarizeChanges(tracker);
    return summary.filesCount > 0 ? summary : null;
  }

  function publishChanges(): void {
    if (!auroraEpoch) return;
    publishFrontendUiPatch(pi, auroraEpoch, "diff-viewer", {
      changes: auroraChangesState(),
    });
  }

  function subscribeAuroraProvider(): void {
    unsubscribeAurora?.();
    unsubscribeAurora = pi.events.on(FRONTEND_UI_CHANNELS.request, (value) => {
      if (!isFrontendUiStateRequest(value)) return;
      auroraEpoch = value.sessionEpoch;
      publishFrontendUiSnapshot(pi, value, "diff-viewer", {
        changes: auroraChangesState(),
      });
    });
  }

  async function openChanges(ctx: ExtensionContext): Promise<void> {
    if (ctx.mode !== "tui") {
      ctx.ui.notify("Diff-Check benötigt den interaktiven Modus", "warning");
      return;
    }
    const changes = tracker.changedFiles;
    if (changes.length === 0) {
      ctx.ui.notify("Keine Edit-/Write-Operationen in dieser Session.", "info");
      return;
    }
    await ctx.ui.custom<void>(
      (tui: TUI, theme: Theme, _keybindings, done) => {
        const browser = new DiffBrowserComponent(
          changes,
          theme,
          (path) => {
            const change = changes.find((candidate) => candidate.path === path);
            return change
              ? {
                  stats: change.stats,
                  hunks: change.hunks,
                  timestamp: change.timestamp,
                }
              : null;
          },
          Math.max(12, Math.floor((process.stdout.rows ?? 40) * 0.8) - 2),
          () => tui.requestRender(),
        );
        browser.onClose = () => done();
        return browser;
      },
      {
        overlay: true,
        overlayOptions: {
          anchor: "center",
          width: "90%",
          maxHeight: "80%",
          margin: 1,
        },
      },
    );
  }

  function updateLivePreview(ctx: ExtensionContext): void {
    if (ctx.mode !== "tui" || !ctx.hasUI) return;
    const preview = [...livePreviews.values()].at(-1);
    if (!preview) {
      ctx.ui.setWidget(LIVE_PREVIEW_WIDGET, undefined);
      return;
    }
    ctx.ui.setWidget(
      LIVE_PREVIEW_WIDGET,
      (_tui, theme) => ({
        render(width: number): string[] {
          return [
            theme.fg("dim", "  Live-Diff-Vorschau"),
            ...renderCompact(
              { ...preview, timestamp: preview.timestamp },
              theme,
              width,
            ),
          ];
        },
        invalidate() {},
      }),
      { placement: "aboveEditor" },
    );
  }

  function discardToolCall(toolCallId: string, ctx?: ExtensionContext): void {
    pendingDiffs.delete(toolCallId);
    livePreviews.delete(toolCallId);
    if (ctx) updateLivePreview(ctx);
  }

  pi.on("session_start", (_event, ctx) => {
    activeCtx = ctx;
    tracker.reconstructFromSession(ctx);
    auroraEpoch = undefined;
    subscribeAuroraProvider();
  });

  pi.on("session_shutdown", (_event, ctx) => {
    pendingDiffs.clear();
    livePreviews.clear();
    tracker.reset();
    if (ctx.mode === "tui" && ctx.hasUI)
      ctx.ui.setWidget(LIVE_PREVIEW_WIDGET, undefined);
    activeCtx = null;
    unsubscribeAurora?.();
    unsubscribeAurora = undefined;
    auroraEpoch = undefined;
  });

  pi.registerEntryRenderer("diff-view", (entry, options, theme) => {
    const data = entry.data as DiffViewEntryData | undefined;
    if (!data?.path || !data.stats || !data.hunks) {
      return new Text(theme.fg("dim", "  (Diff nicht verfügbar)"), 1, 0);
    }
    return new DiffEntryComponent(theme, data, options.expanded);
  });

  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "edit" && event.toolName !== "write") return;
    const args = event.input as {
      path?: string;
      edits?: Array<{ oldText: string; newText: string }>;
      content?: string;
    };
    if (!args.path) return;

    const cwd = activeCtx?.cwd ?? ctx.cwd;
    const oldContent = (await readCurrentFile(cwd, args.path)) ?? "";
    let expectedContent: string | undefined;
    if (event.toolName === "edit" && args.edits) {
      expectedContent = oldContent;
      for (const edit of args.edits)
        expectedContent = expectedContent.replace(edit.oldText, edit.newText);
    } else if (event.toolName === "write" && args.content !== undefined) {
      expectedContent = args.content;
    }
    if (expectedContent === undefined) return;

    const path = toWorkspaceRelative(cwd, args.path);
    const timestamp = Date.now();
    let preview: DiffViewEntryData | undefined;
    if (ctx.mode === "tui" && ctx.hasUI) {
      const diff = computeFallbackDiff(path, oldContent, expectedContent);
      preview = {
        path,
        stats: diff.stats,
        hunks: diff.hunks,
        toolName: event.toolName,
        timestamp,
      };
      livePreviews.set(event.toolCallId, preview);
      updateLivePreview(ctx);
    }
    pendingDiffs.set(event.toolCallId, {
      path,
      oldContent,
      expectedContent,
      timestamp,
      preview,
    });
  });

  pi.on("tool_result", async (event, ctx) => {
    if (event.toolName !== "edit" && event.toolName !== "write") return;
    const pending = pendingDiffs.get(event.toolCallId);
    livePreviews.delete(event.toolCallId);
    updateLivePreview(ctx);
    if (event.isError) {
      pendingDiffs.delete(event.toolCallId);
      return;
    }

    const args = event.input as { path?: string };
    if (!args.path || !pending) {
      pendingDiffs.delete(event.toolCallId);
      return;
    }

    try {
      // Vorher-/Nachher-Snapshots isolieren exakt diese Tool-Operation und
      // vermeiden, dass bereits vorhandene Working-Tree-Änderungen erscheinen.
      const newContent = (await readCurrentFile(ctx.cwd, args.path)) ?? "";
      const actual =
        newContent === pending.expectedContent && pending.preview
          ? pending.preview
          : (() => {
              const diff = computeFallbackDiff(
                pending.path,
                pending.oldContent,
                newContent,
              );
              return {
                path: pending.path,
                stats: diff.stats,
                hunks: diff.hunks,
                toolName: event.toolName,
                timestamp: pending.timestamp,
              } satisfies DiffViewEntryData;
            })();
      const data: DiffViewEntryData = {
        path: actual.path,
        stats: actual.stats,
        hunks: actual.hunks,
        toolName: event.toolName,
        timestamp: pending.timestamp,
      };
      if (data.stats.linesAdded > 0 || data.stats.linesRemoved > 0) {
        pi.appendEntry("diff-view", data);
        tracker.recordChange(
          data.path,
          event.toolName,
          data.stats,
          data.hunks,
          data.timestamp,
        );
        publishChanges();
      }
    } finally {
      pendingDiffs.delete(event.toolCallId);
    }
  });

  pi.on("tool_execution_end", (event, ctx) => {
    if (event.toolName !== "edit" && event.toolName !== "write") return;
    // Normalerweise folgt tool_result vorher; bei abgebrochenen/resultatlosen
    // Ausführungen verhindert dies einen bis zum Session-Ende lebenden Snapshot.
    discardToolCall(event.toolCallId, ctx);
  });

  pi.registerCommand("changes", {
    description: catalogDescription("changes"),
    handler: async (_args, ctx) => openChanges(ctx),
  });
}
