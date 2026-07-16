import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

export interface ActiveToolView {
  id: string;
  name: string;
  target?: string;
  startedAt: number;
}

function firstString(
  args: unknown,
  candidates: readonly string[],
): string | undefined {
  if (!args || typeof args !== "object") return undefined;
  const values = args as Record<string, unknown>;
  for (const key of candidates) {
    const value = values[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

export function compactToolTarget(toolName: string, args: unknown): string | undefined {
  const target = firstString(args, [
    "path",
    "file_path",
    "query",
    "pattern",
    "command",
    "url",
    "symbol",
    "name",
  ]);
  if (!target) return undefined;
  if (toolName === "bash") return target.replace(/\s+/g, " ");
  return target;
}

/**
 * Renders lifecycle metadata only. Aurora deliberately does not re-register or
 * wrap tools, so argument validation, execution, cancellation, updates and
 * results continue to be handled exactly by Pi's core tool definitions.
 */
export function renderActiveTools(
  tools: readonly ActiveToolView[],
  theme: Theme,
  width: number,
  now: number,
): string[] {
  const available = Math.max(1, width);
  return tools.slice(0, width < 74 ? 1 : 3).map((tool) => {
    const elapsed = Math.max(0, Math.floor((now - tool.startedAt) / 1000));
    const target = tool.target ? `  ${theme.fg("muted", tool.target)}` : "";
    const line = `${theme.fg("accent", "◆")} ${theme.bold(tool.name)}${target} ${theme.fg("dim", `${elapsed}s`)}`;
    return truncateToWidth(line, available, "…");
  });
}
