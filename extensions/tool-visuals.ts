/**
 * Tool-Visuals Extension
 *
 * Visuell verstärkte Renderer für die Built-in-Tools (`read`, `bash`, `edit`,
 * `write`). Die Originaltools werden per `create*Tool()` instantiiert und per
 * Spread vollständig übernommen; nur `renderShell`, `renderCall` und
 * `renderResult` werden überschrieben. So bleiben Prompt-Snippets,
 * Guidelines, Argument-Shims, Execution-Metadaten und die Ausführungslogik der
 * Originaltools erhalten.
 *
 * Jeder Aufruf hinterlässt unabhängig von der Terminalbreite mindestens eine
 * kompakte Verlaufsspur. Aufgeklappte Aufrufe und Fehler zeigen die volle Box;
 * Fehler werden immer initial geöffnet und beginnen mit der Ursache.
 */

import type {
  BashToolDetails,
  ExtensionAPI,
  ReadToolDetails,
} from "@earendil-works/pi-coding-agent";
import {
  createBashTool,
  createEditTool,
  createReadTool,
  createWriteTool,
} from "@earendil-works/pi-coding-agent";
import {
  createInfoBoxComponent,
  type InfoBoxComponent,
  type InfoBoxSection,
  type InfoBoxTheme,
} from "./shared/info-box.ts";
import {
  glyphsFor,
  resolveRenderProfile,
  truncatePlain,
  type RenderGlyphs,
  type RenderProfile,
} from "./shared/render-profile.ts";
import { argNumber, argString, shortPreview } from "./shared/tool-labels.ts";
import { loadUiConfig } from "./shared/ui-config.ts";

const MAX_PREVIEW_CHARS = 400;
const MAX_PREVIEW_LINES = 5;
const MAX_COMPACT_LINE_WIDTH = 200;

type ToolStatus = "pending" | "running" | "completed" | "failed";

function toolStatusSymbol(status: ToolStatus, glyphs: RenderGlyphs): string {
  switch (status) {
    case "pending":
      return glyphs.status.idle;
    case "running":
      return glyphs.status.running;
    case "failed":
      return glyphs.status.failed;
    case "completed":
    default:
      return glyphs.status.completed;
  }
}

function toolStatusLabel(status: ToolStatus): string {
  switch (status) {
    case "pending":
      return "wartet";
    case "running":
      return "läuft";
    case "failed":
      return "fehlgeschlagen";
    case "completed":
    default:
      return "erledigt";
  }
}

function inferToolStatus(
  isPartial: boolean,
  isError: boolean,
  executionStarted?: boolean,
): ToolStatus {
  if (isPartial) return "running";
  if (executionStarted === false) return "pending";
  if (isError) return "failed";
  return "completed";
}

function buildPreviewLines(output: string, maxLines: number): string[] {
  const lines = output.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length === 0) return [];
  const visible = lines.slice(0, maxLines);
  if (lines.length > maxLines) {
    visible.push(`… ${lines.length - maxLines} weitere Zeile(n)`);
  }
  return visible;
}

function extractExitCode(output: string): number | undefined {
  const match = output.match(
    /(?:exit(?:ed)?(?:\s+with)?(?:\s+code)?|exit-code)\s*[:=]?\s*(-?\d+)/i,
  );
  return match ? Number.parseInt(match[1]!, 10) : undefined;
}

function firstErrorCause(output: string): string {
  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return "Keine Fehlerdetails verfügbar";
  return (
    lines.find((line) =>
      /error|failed|failure|denied|not found|no such|invalid|cannot|can't|unable|exception|fatal/i.test(
        line,
      ),
    ) ?? lines[0]!
  );
}

function errorSection(
  output: string,
  exitCode?: number,
  showUnknownExitCode = false,
): InfoBoxSection {
  const lines = [`Ursache: ${firstErrorCause(output)}`];
  if (exitCode !== undefined || showUnknownExitCode) {
    lines.push(`Exit-Code: ${exitCode ?? "unbekannt"}`);
  }
  return { title: "Fehler", lines };
}

function renderToolBox(options: {
  title: string;
  subtitle?: string;
  status: ToolStatus;
  sections: InfoBoxSection[];
  expanded: boolean;
  theme: InfoBoxTheme;
  profile: RenderProfile;
}): InfoBoxComponent {
  const { title, subtitle, status, sections, expanded, theme, profile } =
    options;
  const glyphs = glyphsFor(profile);
  const isError = status === "failed";
  const isRunning = status === "running";
  const tone = isError ? "error" : isRunning ? "warning" : "success";
  const background = isError
    ? "toolErrorBg"
    : isRunning
      ? "toolPendingBg"
      : "toolSuccessBg";

  return createInfoBoxComponent(
    {
      title,
      subtitle,
      status: {
        symbol: toolStatusSymbol(status, glyphs),
        label: toolStatusLabel(status),
      },
      sections,
      tone,
      background,
      collapsible: true,
      expanded,
      maxPreviewLines: MAX_PREVIEW_LINES,
      profile,
    },
    theme,
  );
}

/**
 * Wählt pro Redraw zwischen voller Box und kompakter Verlaufsspur. Es gibt
 * bewusst keinen unsichtbaren Zustand.
 */
function adaptiveToolComponent(options: {
  title: string;
  subtitle?: string;
  status: ToolStatus;
  sections: InfoBoxSection[];
  expanded: boolean;
  theme: InfoBoxTheme;
  profile: RenderProfile;
}): InfoBoxComponent {
  const { title, subtitle, status, expanded, theme, profile } = options;
  const alwaysFull = status === "failed" || expanded;
  const box = renderToolBox({ ...options, expanded: alwaysFull });
  const glyphs = glyphsFor(profile);

  const compactLabel = subtitle ? `${title} (${subtitle})` : title;

  return {
    render(width: number): string[] {
      if (alwaysFull) {
        return box.render(width);
      }
      const symbol = toolStatusSymbol(status, glyphs);
      const color = status === "running" ? "warning" : "muted";
      const raw = truncatePlain(
        `${symbol} ${compactLabel}`,
        Math.min(width, MAX_COMPACT_LINE_WIDTH),
        glyphs.ellipsis,
      );
      return [theme.fg(color, raw)];
    },
    invalidate(): void {
      box.invalidate();
    },
  };
}

function argNumberOrUndefined(args: unknown, key: string): number | undefined {
  return argNumber(args, key);
}

export default function toolVisualsExtension(pi: ExtensionAPI): void {
  const cwd = process.cwd();
  const expandToolHistory = loadUiConfig().toolHistory === "full";

  // --- read ---
  const originalRead = createReadTool(cwd);
  pi.registerTool({
    ...originalRead,
    renderShell: "self",
    renderCall(args, theme, context) {
      const profile = resolveRenderProfile({ mode: "tui" });
      const status = inferToolStatus(false, false, context.executionStarted);
      const sections: InfoBoxSection[] = [];
      const offset = argNumberOrUndefined(args, "offset");
      const limit = argNumberOrUndefined(args, "limit");
      if (offset || limit) {
        const parts: string[] = [];
        if (offset) parts.push(`offset=${offset}`);
        if (limit) parts.push(`limit=${limit}`);
        sections.push({ title: "Parameter", lines: [parts.join(", ")] });
      }
      return adaptiveToolComponent({
        title: `read ${argString(args, "path")}`,
        status,
        sections,
        expanded: context.expanded || expandToolHistory,
        theme,
        profile,
      });
    },
    renderResult(result, options, theme, context) {
      const profile = resolveRenderProfile({ mode: "tui" });
      const content = result.content[0];
      const details = result.details as ReadToolDetails | undefined;
      const status = inferToolStatus(options.isPartial, context.isError);
      const sections: InfoBoxSection[] = [];

      if (status === "failed") {
        const output = content?.type === "text" ? content.text : "";
        sections.push(errorSection(output));
      }

      if (content?.type === "image") {
        sections.push({ title: "Ergebnis", lines: ["Bild"] });
      } else if (content?.type === "text") {
        const lineCount = content.text.split("\n").length;
        const meta = [`${lineCount} Zeilen gelesen`];
        if (details?.truncation?.truncated) {
          meta.push(`gekürzt von ${details.truncation.totalLines} Zeilen`);
        }
        sections.push({ title: "Metadaten", lines: meta });
        if (status === "completed" || status === "failed") {
          const preview = buildPreviewLines(content.text, MAX_PREVIEW_LINES);
          if (preview.length > 0) {
            sections.push({ title: "Vorschau", lines: preview });
          }
        }
      }

      return adaptiveToolComponent({
        title: `read ${argString(context.args, "path")}`,
        status,
        sections,
        expanded: options.expanded || expandToolHistory,
        theme,
        profile,
      });
    },
  });

  // --- bash ---
  const originalBash = createBashTool(cwd);
  pi.registerTool({
    ...originalBash,
    renderShell: "self",
    renderCall(args, theme, context) {
      const profile = resolveRenderProfile({ mode: "tui" });
      const status = inferToolStatus(false, false, context.executionStarted);
      const timeout = argNumberOrUndefined(args, "timeout");
      const sections: InfoBoxSection[] = timeout
        ? [{ title: "Timeout", lines: [`${timeout}s`] }]
        : [];
      return adaptiveToolComponent({
        title: `$ ${shortPreview(argString(args, "command", ""), 120)}`,
        status,
        sections,
        expanded: context.expanded || expandToolHistory,
        theme,
        profile,
      });
    },
    renderResult(result, options, theme, context) {
      const profile = resolveRenderProfile({ mode: "tui" });
      const content = result.content[0];
      const details = result.details as BashToolDetails | undefined;
      const output = content?.type === "text" ? content.text : "";
      const exitCode = extractExitCode(output);
      const isError = context.isError || (exitCode !== undefined && exitCode !== 0);
      const status = inferToolStatus(options.isPartial, isError);
      const lineCount = output.split("\n").filter((l) => l.trim()).length;

      const meta: string[] = [`${lineCount} Zeilen Ausgabe`];
      if (status !== "failed" && exitCode !== undefined) {
        meta.push(`Exit-Code: ${exitCode}`);
      }
      if (details?.truncation?.truncated) meta.push("Ausgabe gekürzt");

      const sections: InfoBoxSection[] = [];
      if (status === "failed") {
        sections.push(errorSection(output, exitCode, true));
      }
      sections.push({ title: "Metadaten", lines: meta });
      if (status === "completed" || status === "failed") {
        const preview = buildPreviewLines(output, MAX_PREVIEW_LINES);
        if (preview.length > 0) {
          sections.push({ title: "Vorschau", lines: preview });
        }
      }

      return adaptiveToolComponent({
        title: `$ ${shortPreview(argString(context.args, "command", ""), 120)}`,
        status,
        sections,
        expanded: options.expanded || expandToolHistory,
        theme,
        profile,
      });
    },
  });

  // --- edit ---
  const originalEdit = createEditTool(cwd);
  pi.registerTool({
    ...originalEdit,
    renderShell: "self",
    renderCall(args, theme, context) {
      const profile = resolveRenderProfile({ mode: "tui" });
      const edits = Array.isArray((args as { edits?: unknown }).edits)
        ? (args as { edits: unknown[] }).edits
        : [];
      const status = inferToolStatus(false, false, context.executionStarted);
      return adaptiveToolComponent({
        title: `edit ${argString(args, "path")}`,
        subtitle: `${edits.length} ${edits.length === 1 ? "Block" : "Blöcke"}`,
        status,
        sections: [],
        expanded: context.expanded || expandToolHistory,
        theme,
        profile,
      });
    },
    renderResult(result, options, theme, context) {
      const profile = resolveRenderProfile({ mode: "tui" });
      const content = result.content[0];
      const isError =
        context.isError ||
        (content?.type === "text" && content.text.startsWith("Error"));
      const status = inferToolStatus(options.isPartial, isError);
      const sections: InfoBoxSection[] = [];
      if (isError && content?.type === "text") {
        sections.push(errorSection(content.text));
        const preview = buildPreviewLines(content.text, MAX_PREVIEW_LINES);
        if (preview.length > 0) {
          sections.push({ title: "Vorschau", lines: preview });
        }
      } else if (isError) {
        sections.push(errorSection(""));
      }
      return adaptiveToolComponent({
        title: `edit ${argString(context.args, "path")}`,
        status,
        sections,
        expanded: options.expanded || expandToolHistory,
        theme,
        profile,
      });
    },
  });

  // --- write ---
  const originalWrite = createWriteTool(cwd);
  pi.registerTool({
    ...originalWrite,
    renderShell: "self",
    renderCall(args, theme, context) {
      const profile = resolveRenderProfile({ mode: "tui" });
      const content = argString(args, "content", "");
      const lineCount = content.split("\n").length;
      const status = inferToolStatus(false, false, context.executionStarted);
      return adaptiveToolComponent({
        title: `write ${argString(args, "path")}`,
        subtitle: `${lineCount} Zeile${lineCount === 1 ? "" : "n"}`,
        status,
        sections: [],
        expanded: context.expanded || expandToolHistory,
        theme,
        profile,
      });
    },
    renderResult(result, options, theme, context) {
      const profile = resolveRenderProfile({ mode: "tui" });
      const content = result.content[0];
      const isError =
        context.isError ||
        (content?.type === "text" && content.text.startsWith("Error"));
      const status = inferToolStatus(options.isPartial, isError);
      const sections: InfoBoxSection[] = [];
      if (isError && content?.type === "text") {
        sections.push(errorSection(content.text));
        const preview = buildPreviewLines(content.text, MAX_PREVIEW_LINES);
        if (preview.length > 0) {
          sections.push({ title: "Vorschau", lines: preview });
        }
      } else if (isError) {
        sections.push(errorSection(""));
      }
      return adaptiveToolComponent({
        title: `write ${argString(context.args, "path")}`,
        status,
        sections,
        expanded: options.expanded || expandToolHistory,
        theme,
        profile,
      });
    },
  });
}
