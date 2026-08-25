/**
 * Wraps a tool definition's `renderResult` so the collapsed (non-expanded)
 * view shows nothing but a "ctrl+o to expand" hint instead of a multi-line
 * preview. The original `renderResult` still runs untouched whenever the
 * view is expanded, the result is an error, or the tool is still streaming
 * partial output — those cases must stay visible without requiring ctrl+o.
 */
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { keyHint } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

function extractText(result: {
  content: Array<{ type: string; text?: string }>;
}): string {
  return result.content
    .map((part) => (part.type === "text" ? (part.text ?? "") : ""))
    .join("\n")
    .trim();
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

export function collapseResult(
  tool: ToolDefinition<any, any, any>,
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
      const hasOutput = extractText(result).length > 0;
      component.setText(
        hasOutput
          ? `  ${theme.fg("muted", keyHint("app.tools.expand", "to expand"))}`
          : "",
      );
      return component;
    },
  };
}
