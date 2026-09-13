/**
 * Wraps a tool definition's result renderer with a single informative receipt
 * for successful, finished collapsed results. Full detail remains available via
 * Ctrl+O and stays directly visible for errors, streaming output, truncation
 * notices supplied by the native renderer, and unexpected empty output.
 */
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { toWorkspaceRelative } from "../shared/paths.ts";

function extractText(result: {
  content: Array<{ type: string; text?: string }>;
}): string {
  return result.content
    .map((part) => (part.type === "text" ? (part.text ?? "") : ""))
    .join("\n")
    .trim();
}

function outputLines(text: string): string[] {
  return text.split("\n").map((line) => line.trim()).filter(Boolean);
}

function oneLine(value: string, max = 96): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length <= max ? compact : `${compact.slice(0, max - 1)}…`;
}

function valueAt(args: unknown, key: string): string | number | undefined {
  if (typeof args !== "object" || args === null) return undefined;
  const value = (args as Record<string, unknown>)[key];
  return typeof value === "string" || typeof value === "number" ? value : undefined;
}

function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function summarize(
  tool: ToolDefinition<any, any, any>,
  args: unknown,
  text: string,
  cwd?: string,
): string {
  const lines = outputLines(text);
  const rawPath = valueAt(args, "path") ?? valueAt(args, "file_path");
  const path =
    typeof rawPath === "string" && rawPath
      ? cwd
        ? toWorkspaceRelative(cwd, rawPath)
        : rawPath
      : undefined;
  switch (tool.name) {
    case "read": {
      const offset = valueAt(args, "offset");
      const first = typeof offset === "number" ? offset : 1;
      const last = first + Math.max(0, lines.length - 1);
      const range = lines.length > 0 ? `Zeilen ${first}–${last}` : "keine Zeilen";
      return `${path ?? "Datei"} · ${range}`;
    }
    case "grep": {
      const files = new Set(
        lines
          .map((line) => line.match(/^(.+?):\d+(?::|$)/)?.[1])
          .filter((file): file is string => file !== undefined),
      );
      const scope = path ? ` in ${path}` : "";
      const pattern = valueAt(args, "pattern") ?? valueAt(args, "query");
      const patternLabel = typeof pattern === "string" ? ` „${oneLine(pattern, 32)}"` : "";
      const fileLabel = files.size > 0 ? ` · ${plural(files.size, "Datei", "Dateien")}` : "";
      return `${plural(lines.length, "Treffer", "Treffer")}${fileLabel}${scope}${patternLabel}`;
    }
    case "find":
      return `${plural(lines.length, "Datei", "Dateien")} in ${path ?? "."}`;
    case "ls":
      return `${plural(lines.length, "Eintrag", "Einträge")} in ${path ?? "."}`;
    case "write":
      return `geschrieben: ${path ?? "Datei"}`;
    case "bash": {
      const testLine = [...lines]
        .reverse()
        .find((line) => /\b(pass(?:ed)?|fail(?:ed)?|tests?|ok|success)\b/i.test(line));
      return testLine ? `Exit 0 · ${oneLine(testLine)}` : `Exit 0 · ${plural(lines.length, "Ausgabezeile", "Ausgabezeilen")}`;
    }
    default:
      return plural(lines.length, "Ausgabezeile", "Ausgabezeilen");
  }
}

/**
 * `context.lastComponent` may come from a `Text` built by pi-coding-agent's
 * own bundled copy of pi-tui, a different module instance than the one this
 * package imports — `instanceof Text` fails across that boundary even for a
 * real `Text`. Structural detection of `setText` works regardless of which
 * copy constructed it.
 */
function isReusableTextComponent(
  value: unknown,
): value is { setText(text: string): void } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { setText?: unknown }).setText === "function"
  );
}

function formatCallTarget(toolName: string, args: unknown, cwd?: string): string {
  const rawPath = valueAt(args, "path") ?? valueAt(args, "file_path");
  const pathStr =
    typeof rawPath === "string" && rawPath
      ? cwd
        ? toWorkspaceRelative(cwd, rawPath)
        : rawPath
      : undefined;
  switch (toolName) {
    case "read": {
      const offset = valueAt(args, "offset");
      const limit = valueAt(args, "limit");
      const range =
        typeof offset === "number"
          ? `:${offset}${typeof limit === "number" ? `-${offset + limit - 1}` : ""}`
          : "";
      return `${pathStr ?? "Datei"}${range}`;
    }
    case "write":
    case "edit":
      return pathStr ?? "Datei";
    case "grep": {
      const pattern = valueAt(args, "pattern") ?? valueAt(args, "query");
      const patStr = typeof pattern === "string" ? `„${oneLine(pattern, 32)}"` : "";
      return [patStr, pathStr ? `in ${pathStr}` : ""].filter(Boolean).join(" ");
    }
    case "find": {
      const pattern = valueAt(args, "pattern");
      return [
        typeof pattern === "string" ? `„${pattern}"` : "",
        pathStr ? `in ${pathStr}` : "",
      ]
        .filter(Boolean)
        .join(" ");
    }
    case "ls":
      return pathStr ?? ".";
    case "bash": {
      const cmd = valueAt(args, "command");
      return typeof cmd === "string" ? oneLine(cmd, 60) : "";
    }
    default:
      return pathStr ?? "";
  }
}

export function collapseCall(
  tool: ToolDefinition<any, any, any>,
  boundCwd?: string,
): ToolDefinition<any, any, any> {
  return {
    ...tool,
    renderCall(args, theme, context) {
      const component = isReusableTextComponent(context.lastComponent)
        ? context.lastComponent
        : new Text("", 0, 0);
      const cwd = boundCwd ?? context.cwd;
      const target = formatCallTarget(tool.name, args, cwd);
      const targetText = target ? ` ${theme.fg("muted", target)}` : "";
      component.setText(
        `${theme.fg("dim", "›")} ${theme.fg("accent", tool.name)}${targetText}`,
      );
      return component;
    },
  };
}

export function collapseResult(
  tool: ToolDefinition<any, any, any>,
  boundCwd?: string,
): ToolDefinition<any, any, any> {
  const original = tool.renderResult;
  if (!original) return tool;

  return {
    ...tool,
    renderResult(result, options, theme, context) {
      if (options.expanded || options.isPartial || context.isError) {
        return original(result, options, theme, context);
      }
      const component = isReusableTextComponent(context.lastComponent)
        ? context.lastComponent
        : new Text("", 0, 0);
      const text = extractText(result);
      const cwd = boundCwd ?? context.cwd;
      const receipt = text
        ? summarize(tool, context.args, text, cwd)
        : `${tool.label ?? tool.name} · keine Ausgabe`;
      component.setText(
        `  ${theme.fg("muted", receipt)} ${theme.fg("dim", "· Ctrl+O Details")}`,
      );
      return component;
    },
  };
}

