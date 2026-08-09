import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { footerTier } from "../shared/layout.ts";

/** The compact running marker shared by tool rows. */
export const RUNNING_GLYPH = "◌";

export interface ActiveToolView {
  id: string;
  name: string;
  target?: string;
  startedAt: number;
}

/**
 * A subagent the current turn started. Aurora keeps no state machine of its
 * own for these: foreground runs come straight off the `subagent` tool call,
 * async runs off the status reply the subagent package already publishes.
 */
export interface SubagentInfo {
  agent: string;
  phase?: string;
  label?: string;
  status: "running" | "paused" | "needs_attention" | "queued";
}

interface ToolPresentation {
  glyph: string;
  label: string;
}

const TOOL_PRESENTATIONS: Record<string, ToolPresentation> = {
  read: { glyph: "◌", label: "Read" },
  grep: { glyph: "⌕", label: "Grep" },
  rg: { glyph: "⌕", label: "Grep" },
  bash: { glyph: "›", label: "Bash" },
  edit: { glyph: "✎", label: "Edit" },
  write: { glyph: "✎", label: "Edit" },
  subagent: { glyph: "◇", label: "Agent" },
};

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

export function compactToolTarget(
  toolName: string,
  args: unknown,
): string | undefined {
  const target = firstString(args, [
    "path",
    "file_path",
    "file",
    "query",
    "pattern",
    "command",
    "url",
    "symbol",
    "name",
    "role",
    "task",
    "target",
  ]);
  if (!target) return undefined;
  if (toolName === "bash") return target.replace(/\s+/g, " ");
  return target;
}

export function toolPresentation(name: string): ToolPresentation {
  return (
    TOOL_PRESENTATIONS[name.toLowerCase()] ?? {
      glyph: RUNNING_GLYPH,
      label: name || "Tool",
    }
  );
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
  options: { compact?: boolean } = {},
): string[] {
  const available = Math.max(1, width);
  const compact = options.compact ?? footerTier(width) === "compact";
  const limit = compact ? 1 : 3;
  const visible = tools.slice(0, limit).map((tool) => {
    const elapsed = Math.max(0, Math.floor((now - tool.startedAt) / 1000));
    const presentation = toolPresentation(tool.name);
    const target = tool.target ? `  ${theme.fg("muted", tool.target)}` : "";
    const marker = theme.fg("accent", presentation.glyph);
    const line = `${marker} ${theme.bold(presentation.label)}${target} ${theme.fg("dim", `${elapsed}s`)}`;
    return truncateToWidth(line, available, "…");
  });
  const hidden = tools.length - visible.length;
  if (hidden > 0)
    visible.push(
      truncateToWidth(
        theme.fg("muted", `↳ +${hidden} weitere Tools`),
        available,
        "…",
      ),
    );
  return visible;
}

function subagentTone(
  status: SubagentInfo["status"],
): "success" | "warning" | "error" | "muted" {
  switch (status) {
    case "running":
      return "success";
    case "paused":
      return "warning";
    case "needs_attention":
      return "error";
    case "queued":
      return "muted";
  }
}

function subagentGlyph(status: SubagentInfo["status"]): string {
  switch (status) {
    case "running":
      return "◉";
    case "queued":
      return "○";
    case "paused":
      return "◌";
    case "needs_attention":
      return "!";
  }
}

/**
 * Subagents appear inline with the work that started them, for as long as that
 * work runs — no permanent tab strip, no navigation level of their own. When
 * the turn settles the widget goes away with everything else in it.
 */
export function renderSubagents(
  subagents: readonly SubagentInfo[],
  theme: Theme,
  width: number,
  options: { compact?: boolean } = {},
): string[] {
  if (subagents.length === 0) return [];
  const available = Math.max(1, width);
  const compact = options.compact ?? footerTier(width) === "compact";
  const clip = (value: string) => truncateToWidth(value, available, "…");
  const attention = subagents.filter(
    (entry) => entry.status === "needs_attention",
  ).length;
  const summary = clip(
    compact
      ? `${theme.fg("muted", "▾")} ${theme.fg("text", `Subagents · ${subagents.length} aktiv`)}`
      : theme.bold(theme.fg("border", `SUBAGENTS  ${subagents.length} aktiv`)),
  );
  const attentionLine = attention
    ? theme.fg("error", ` · ${attention} Aufmerksamkeit`)
    : "";
  const summaryWithAttention = clip(`${summary}${attentionLine}`);
  if (compact) return [summaryWithAttention];

  // Whatever needs a decision is worth the few lines this surface has.
  const ordered = [...subagents].sort(
    (a, b) =>
      Number(b.status === "needs_attention") -
      Number(a.status === "needs_attention"),
  );
  const visible = ordered.slice(0, 3);
  const lines = visible.flatMap((entry) => {
    const glyph = theme.fg(subagentTone(entry.status), subagentGlyph(entry.status));
    const rows = [clip(`   ${glyph} ${theme.bold(entry.agent)}`)];
    const detail = entry.phase ?? entry.label;
    if (detail) rows.push(clip(`     ${theme.fg("muted", `↳ ${detail}`)}`));
    return rows;
  });
  const hidden = subagents.length - visible.length;
  if (hidden > 0)
    lines.push(clip(`   ${theme.fg("muted", `↳ +${hidden} weitere`)}`));
  return [summaryWithAttention, ...lines];
}
