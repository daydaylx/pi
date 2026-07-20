/** Verbesserte, session-basierte Diff-Darstellung für edit/write-Operationen. */
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { Text } from "@earendil-works/pi-tui";
import type { DiffViewEntryData } from "./types.ts";
import { ChangeTracker } from "./change-tracker.ts";
import { computeFallbackDiff } from "./git-diff.ts";
import { renderCompact } from "./diff-renderer.ts";
import { DiffBrowserComponent } from "./diff-browser.ts";
import { DiffEntryComponent } from "./diff-entry.ts";

const LIVE_PREVIEW_WIDGET = "diff-viewer/live-preview";

interface PendingDiff {
  data: DiffViewEntryData;
  oldContent: string;
}

async function readCurrentFile(pi: ExtensionAPI, cwd: string, filePath: string): Promise<string | null> {
  try {
    const result = await pi.exec("cat", [filePath], { cwd, timeout: 5000 });
    return result.code === 0 ? result.stdout : null;
  } catch {
    return null;
  }
}

function displayPath(cwd: string, path: string): string {
  const target = isAbsolute(path) ? path : resolve(cwd, path);
  const relativePath = relative(cwd, target);
  if (relativePath && relativePath !== ".." && !relativePath.startsWith(`..${sep}`)) {
    return relativePath;
  }
  return path;
}

export default function diffViewerExtension(pi: ExtensionAPI): void {
  const tracker = new ChangeTracker();
  const pendingDiffs = new Map<string, PendingDiff>();
  const livePreviews = new Map<string, DiffViewEntryData>();
  let activeCtx: ExtensionContext | null = null;

  function updateLivePreview(ctx: ExtensionContext): void {
    if (ctx.mode !== "tui" || !ctx.hasUI) return;
    const preview = [...livePreviews.values()].at(-1);
    if (!preview) {
      ctx.ui.setWidget(LIVE_PREVIEW_WIDGET, undefined);
      return;
    }
    ctx.ui.setWidget(LIVE_PREVIEW_WIDGET, (_tui, theme) => ({
      render(width: number): string[] {
        return [
          theme.fg("dim", "  Live-Diff-Vorschau"),
          ...renderCompact({ ...preview, timestamp: preview.timestamp }, theme, width),
        ];
      },
      invalidate() {},
    }), { placement: "aboveEditor" });
  }

  function discardToolCall(toolCallId: string, ctx?: ExtensionContext): void {
    pendingDiffs.delete(toolCallId);
    livePreviews.delete(toolCallId);
    if (ctx) updateLivePreview(ctx);
  }

  pi.on("session_start", (_event, ctx) => {
    activeCtx = ctx;
    tracker.reconstructFromSession(ctx);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    pendingDiffs.clear();
    livePreviews.clear();
    tracker.reset();
    if (ctx.mode === "tui" && ctx.hasUI) ctx.ui.setWidget(LIVE_PREVIEW_WIDGET, undefined);
    activeCtx = null;
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
    const oldContent = (await readCurrentFile(pi, cwd, args.path)) ?? "";
    let expectedContent: string | undefined;
    if (event.toolName === "edit" && args.edits) {
      expectedContent = oldContent;
      for (const edit of args.edits) expectedContent = expectedContent.replace(edit.oldText, edit.newText);
    } else if (event.toolName === "write" && args.content !== undefined) {
      expectedContent = args.content;
    }
    if (expectedContent === undefined) return;

    const path = displayPath(cwd, args.path);
    const diff = computeFallbackDiff(path, oldContent, expectedContent);
    const data: DiffViewEntryData = {
      path,
      stats: diff.stats,
      hunks: diff.hunks,
      toolName: event.toolName,
      timestamp: Date.now(),
    };
    pendingDiffs.set(event.toolCallId, { data, oldContent });
    livePreviews.set(event.toolCallId, data);
    updateLivePreview(ctx);
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
      const newContent = (await readCurrentFile(pi, ctx.cwd, args.path)) ?? "";
      const path = displayPath(ctx.cwd, args.path);
      const actual = computeFallbackDiff(path, pending.oldContent, newContent);
      const data: DiffViewEntryData = {
        path,
        stats: actual.stats,
        hunks: actual.hunks,
        toolName: event.toolName,
        timestamp: Date.now(),
      };
      if (data.stats.linesAdded > 0 || data.stats.linesRemoved > 0) {
        pi.appendEntry("diff-view", data);
        tracker.recordChange(path, event.toolName, data.stats, data.hunks, data.timestamp);
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
    description: "Zeigt alle Dateiänderungen der aktuellen Session als Diff-Browser",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("/changes benötigt den interaktiven Modus", "warning");
        return;
      }
      const changes = tracker.changedFiles;
      if (changes.length === 0) {
        ctx.ui.notify("Keine Änderungen in dieser Session", "info");
        return;
      }
      await ctx.ui.custom<void>((tui: TUI, theme: Theme, keybindings, done) => {
        const browser = new DiffBrowserComponent(
          changes,
          theme,
          keybindings,
          (path) => {
            const change = changes.find((candidate) => candidate.path === path);
            return change
              ? { stats: change.stats, hunks: change.hunks, timestamp: change.timestamp }
              : null;
          },
          Math.max(12, Math.floor((process.stdout.rows ?? 40) * 0.8) - 2),
          () => tui.requestRender(),
        );
        browser.onClose = () => done();
        return browser;
      }, {
        overlay: true,
        overlayOptions: { anchor: "center", width: "90%", maxHeight: "80%", margin: 1 },
      });
    },
  });
}
