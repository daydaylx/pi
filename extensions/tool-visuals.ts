/**
 * Tool-Visuals Extension
 *
 * Visuell verstärkte Renderer für die Built-in-Tools (`read`, `bash`, `edit`,
 * `write`). Die Originaltools werden per `create*Tool()` instantiiert und per
 * Spread vollständig übernommen; nur `renderShell`, `renderCall` und
 * `renderResult` werden überschrieben. So bleiben Prompt-Snippets,
 * Guidelines, Argument-Shims, Execution-Metadaten und die Ausführungslogik der
 * Originaltools erhalten.
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
  type RenderGlyphs,
  type RenderProfile,
} from "./shared/render-profile.ts";

const MAX_PREVIEW_CHARS = 400;
const MAX_PREVIEW_LINES = 5;

function shortPreview(value: unknown, max = MAX_PREVIEW_CHARS): string {
  const oneLine = String(value ?? "").replace(/\s+/g, " ").trim();
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`;
}

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

function argString(args: unknown, key: string, fallback = "-"): string {
  if (!args || typeof args !== "object") return fallback;
  const value = (args as Record<string, unknown>)[key];
  return value === undefined || value === null ? fallback : String(value);
}

function argNumber(args: unknown, key: string): number | undefined {
  if (!args || typeof args !== "object") return undefined;
  const value = (args as Record<string, unknown>)[key];
  return typeof value === "number" ? value : undefined;
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
        label: status,
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

export default function toolVisualsExtension(pi: ExtensionAPI): void {
  const cwd = process.cwd();

  // --- read ---
  const originalRead = createReadTool(cwd);
  pi.registerTool({
    ...originalRead,
    renderShell: "self",
    renderCall(args, theme, context) {
      const profile = resolveRenderProfile({ mode: "tui" });
      const status = inferToolStatus(false, false, context.executionStarted);
      const sections: InfoBoxSection[] = [];
      const offset = argNumber(args, "offset");
      const limit = argNumber(args, "limit");
      if (offset || limit) {
        const parts: string[] = [];
        if (offset) parts.push(`offset=${offset}`);
        if (limit) parts.push(`limit=${limit}`);
        sections.push({ title: "Parameter", lines: [parts.join(", ")] });
      }
      return renderToolBox({
        title: `read ${argString(args, "path")}`,
        status,
        sections,
        expanded: context.expanded,
        theme,
        profile,
      });
    },
    renderResult(result, options, theme, context) {
      const profile = resolveRenderProfile({ mode: "tui" });
      const content = result.content[0];
      const details = result.details as ReadToolDetails | undefined;
      const isError = Boolean(result.isError);
      const status = inferToolStatus(options.isPartial, isError);
      const sections: InfoBoxSection[] = [];

      if (content?.type === "image") {
        sections.push({ title: "Ergebnis", lines: ["image"] });
      } else if (content?.type === "text") {
        const lineCount = content.text.split("\n").length;
        const meta = [`${lineCount} Zeilen gelesen`];
        if (details?.truncation?.truncated) {
          meta.push(
            `gekürzt von ${details.truncation.totalLines} Zeilen`,
          );
        }
        sections.push({ title: "Metadaten", lines: meta });
        if (status === "completed") {
          const preview = buildPreviewLines(content.text, MAX_PREVIEW_LINES);
          if (preview.length > 0) {
            sections.push({ title: "Vorschau", lines: preview });
          }
        }
      }

      return renderToolBox({
        title: `read ${argString(context.args, "path")}`,
        status,
        sections,
        expanded: options.expanded,
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
      const timeout = argNumber(args, "timeout");
      const sections: InfoBoxSection[] = timeout
        ? [{ title: "Timeout", lines: [`${timeout}s`] }]
        : [];
      return renderToolBox({
        title: `$ ${shortPreview(argString(args, "command", ""), 120)}`,
        status,
        sections,
        expanded: context.expanded,
        theme,
        profile,
      });
    },
    renderResult(result, options, theme, context) {
      const profile = resolveRenderProfile({ mode: "tui" });
      const content = result.content[0];
      const details = result.details as BashToolDetails | undefined;
      const output = content?.type === "text" ? content.text : "";
      const exitMatch = output.match(/exit code: (\d+)/);
      const exitCode = exitMatch ? parseInt(exitMatch[1]!, 10) : null;
      const isError = Boolean(result.isError) ||
        (exitCode !== null && exitCode !== 0);
      const status = inferToolStatus(options.isPartial, isError);
      const lineCount = output.split("\n").filter((l) => l.trim()).length;

      const meta: string[] = [`${lineCount} Zeilen Output`];
      if (exitCode !== null) meta.push(`Exit-Code: ${exitCode}`);
      if (details?.truncation?.truncated) meta.push("Output gekürzt");

      const sections: InfoBoxSection[] = [{ title: "Metadaten", lines: meta }];
      if (status === "completed" || status === "failed") {
        const preview = buildPreviewLines(output, MAX_PREVIEW_LINES);
        if (preview.length > 0) {
          sections.push({ title: "Vorschau", lines: preview });
        }
      }

      return renderToolBox({
        title: `$ ${shortPreview(argString(context.args, "command", ""), 120)}`,
        status,
        sections,
        expanded: options.expanded,
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
      return renderToolBox({
        title: `edit ${argString(args, "path")}`,
        subtitle: `${edits.length} Block${edits.length === 1 ? "" : "s"}`,
        status,
        sections: [],
        expanded: context.expanded,
        theme,
        profile,
      });
    },
    renderResult(result, options, theme, context) {
      const profile = resolveRenderProfile({ mode: "tui" });
      const content = result.content[0];
      const isError = Boolean(result.isError) ||
        (content?.type === "text" && content.text.startsWith("Error"));
      const status = inferToolStatus(options.isPartial, isError);
      const sections: InfoBoxSection[] = [];
      if (isError && content?.type === "text") {
        sections.push({
          title: "Fehler",
          lines: buildPreviewLines(content.text, MAX_PREVIEW_LINES),
        });
      }
      return renderToolBox({
        title: `edit ${argString(context.args, "path")}`,
        status,
        sections,
        expanded: options.expanded,
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
      return renderToolBox({
        title: `write ${argString(args, "path")}`,
        subtitle: `${lineCount} Zeile${lineCount === 1 ? "" : "n"}`,
        status,
        sections: [],
        expanded: context.expanded,
        theme,
        profile,
      });
    },
    renderResult(result, options, theme, context) {
      const profile = resolveRenderProfile({ mode: "tui" });
      const content = result.content[0];
      const isError = Boolean(result.isError) ||
        (content?.type === "text" && content.text.startsWith("Error"));
      const status = inferToolStatus(options.isPartial, isError);
      const sections: InfoBoxSection[] = [];
      if (isError && content?.type === "text") {
        sections.push({
          title: "Fehler",
          lines: buildPreviewLines(content.text, MAX_PREVIEW_LINES),
        });
      }
      return renderToolBox({
        title: `write ${argString(context.args, "path")}`,
        status,
        sections,
        expanded: options.expanded,
        theme,
        profile,
      });
    },
  });
}
