import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { footerTier } from "../shared/layout.ts";

/** The one glyph for work that is still running, on every Aurora surface. */
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
  const limit = footerTier(width) === "compact" ? 1 : 3;
  const visible = tools.slice(0, limit).map((tool) => {
    const elapsed = Math.max(0, Math.floor((now - tool.startedAt) / 1000));
    const target = tool.target ? `  ${theme.fg("muted", tool.target)}` : "";
    // Running work is the only thing this surface shows, so it carries the
    // running glyph. A finished tool leaves the widget rather than turning
    // into a success block.
    const badge = theme.fg("accent", RUNNING_GLYPH);
    const line = `${badge} ${theme.bold(tool.name)}${target} ${theme.fg("dim", `${elapsed}s`)}`;
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

/**
 * Subagents appear inline with the work that started them, for as long as that
 * work runs — no permanent tab strip, no navigation level of their own. When
 * the turn settles the widget goes away with everything else in it.
 */
export function renderSubagents(
  subagents: readonly SubagentInfo[],
  theme: Theme,
  width: number,
): string[] {
  if (subagents.length === 0) return [];
  const available = Math.max(1, width);
  const clip = (value: string) => truncateToWidth(value, available, "…");
  const attention = subagents.filter(
    (entry) => entry.status === "needs_attention",
  ).length;
  const summary = clip(
    `${theme.fg("muted", "▾")} ${theme.fg("text", `Subagents · ${subagents.length} aktiv`)}${
      attention > 0
        ? ` ${theme.fg("error", `· ${attention} Aufmerksamkeit`)}`
        : ""
    }`,
  );
  if (footerTier(width) === "compact") return [summary];

  // Whatever needs a decision is worth the few lines this surface has.
  const ordered = [...subagents].sort(
    (a, b) =>
      Number(b.status === "needs_attention") -
      Number(a.status === "needs_attention"),
  );
  const visible = ordered.slice(0, 3);
  const lines = visible.flatMap((entry) => {
    const glyph = theme.fg(subagentTone(entry.status), RUNNING_GLYPH);
    const rows = [clip(`  ${glyph} ${theme.bold(entry.agent)}`)];
    const detail = entry.phase ?? entry.label;
    if (detail) rows.push(clip(`    ${theme.fg("muted", detail)}`));
    return rows;
  });
  const hidden = subagents.length - visible.length;
  if (hidden > 0)
    lines.push(clip(`  ${theme.fg("muted", `↳ +${hidden} weitere`)}`));
  return [summary, ...lines];
}
