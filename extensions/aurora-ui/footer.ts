import { homedir } from "node:os";
import { isAbsolute, normalize, relative, sep } from "node:path";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { renderSegment, statusSeparator } from "../shared/ui-theme.ts";
import { crop, layoutFor, type Layout } from "./layout.ts";
import type { AuroraUiState } from "./state.ts";

/** Aurora's compact fallback when the Fleet Status Dock is not active. */
export interface SubagentInfo {
  agent: string;
  phase?: string;
  label?: string;
  status: "running" | "paused" | "needs_attention" | "queued";
}

export interface FooterInput {
  state: AuroraUiState;
  statuses: ReadonlyMap<string, string>;
  branch: string | null;
  cwd: string;
  sessionName: string | undefined;
  tokens: { input: number; output: number };
  contextPercent: number | null;
  subagents?: SubagentInfo[];
}

const GROUP_GAP = "   ";
const CONTEXT_WARNING_PERCENT = 70;

export function compactCwd(cwd: string): string {
  const normalized = normalize(cwd);
  const home = normalize(homedir());
  const fromHome = relative(home, normalized);
  if (fromHome === "") return "~";
  if (
    !isAbsolute(fromHome) &&
    fromHome !== ".." &&
    !fromHome.startsWith(`..${sep}`)
  ) {
    return `~${sep}${fromHome}`;
  }
  return normalized;
}

export function formatTokens(value: number): string {
  if (value < 1_000) return String(value);
  if (value < 1_000_000) return `${(value / 1_000).toFixed(1)}k`;
  return `${(value / 1_000_000).toFixed(1)}m`;
}

export function renderContextGauge(percent: number, theme: Theme): string {
  const filled = Math.min(10, Math.max(0, Math.floor(percent / 10)));
  const bar = "▓".repeat(filled) + "░".repeat(10 - filled);
  const color =
    percent >= 90
      ? "error"
      : percent >= CONTEXT_WARNING_PERCENT
        ? "warning"
        : "success";
  return `${theme.fg(color, bar)} ${theme.fg(color, `${Math.round(percent)}%`)}`;
}

function joinSides(
  theme: Theme,
  left: string,
  right: string,
  width: number,
): string {
  const available = Math.max(1, width);
  const gap = available - visibleWidth(left) - visibleWidth(right);
  if (gap >= 1) return left + " ".repeat(gap) + right;
  if (available < 52)
    return crop(`${left}${statusSeparator(theme)}${right}`, available);
  const clippedLeft = crop(left, Math.max(1, Math.floor(available * 0.55)));
  return crop(
    clippedLeft +
      " ".repeat(
        Math.max(
          1,
          available - visibleWidth(clippedLeft) - visibleWidth(right),
        ),
      ) +
      right,
    available,
  );
}

function permissionTone(
  state: AuroraUiState,
): "text" | "muted" | "warning" | "error" {
  switch (state.permissions.level) {
    case "yolo":
      return "error";
    case "confirm-all":
      return "warning";
    case "readonly":
      return "muted";
    default:
      return "text";
  }
}

function lspTone(state: string): "muted" | "success" | "warning" | "error" {
  if (state === "ready") return "success";
  if (state === "eingeschränkt") return "error";
  if (state === "aus") return "muted";
  return "warning";
}

function lspState(input: FooterInput): string {
  return input.statuses.get("lsp") ?? input.state.lsp.state ?? "—";
}

function permissionLabel(input: FooterInput): string {
  return input.state.permissions.label ?? "—";
}

function diagnostics(
  theme: Theme,
  input: FooterInput,
  includeRoutine: boolean,
): string[] {
  const lines: string[] = [];
  const lsp = lspState(input);
  const context = input.contextPercent;
  const lspNeedsAttention = !["ready", "leerlauf", "aus", "—"].includes(lsp);
  const contextNeedsAttention =
    context !== null && context >= CONTEXT_WARNING_PERCENT;

  if (!includeRoutine && !lspNeedsAttention && !contextNeedsAttention)
    return lines;

  const parts = [renderSegment(theme, `LSP ${lsp}`, { tone: lspTone(lsp) })];
  if (context !== null) {
    const tone =
      context >= 90
        ? "error"
        : context >= CONTEXT_WARNING_PERCENT
          ? "warning"
          : "muted";
    parts.push(
      renderSegment(theme, `Kontext ${Math.round(context)}%`, { tone }),
    );
  }
  lines.push(parts.join(statusSeparator(theme)));
  return lines;
}

function renderNarrow(
  theme: Theme,
  width: number,
  input: FooterInput,
): string[] {
  const project = renderSegment(theme, crop(compactCwd(input.cwd), 30), {
    tone: "text",
    bold: true,
  });
  const permission = renderSegment(theme, permissionLabel(input), {
    tone: permissionTone(input.state),
    bold: true,
  });
  return [
    joinSides(theme, project, permission, width),
    ...diagnostics(theme, input, false).map((line) => crop(line, width)),
  ];
}

function renderNormal(
  theme: Theme,
  width: number,
  input: FooterInput,
): string[] {
  const model = renderSegment(
    theme,
    crop(input.state.model.id ?? "kein Modell", 18),
    {
      tone: "accent",
    },
  );
  const project = renderSegment(theme, crop(compactCwd(input.cwd), 24), {
    tone: "text",
    bold: true,
  });
  const permission = renderSegment(theme, permissionLabel(input), {
    tone: permissionTone(input.state),
    bold: true,
  });
  return [
    joinSides(
      theme,
      `${model}${statusSeparator(theme)}${project}`,
      permission,
      width,
    ),
    ...diagnostics(theme, input, true).map((line) => crop(line, width)),
  ];
}

function renderWide(theme: Theme, width: number, input: FooterInput): string[] {
  const model = renderSegment(
    theme,
    crop(input.state.model.id ?? "kein Modell", 32),
    {
      tone: "accent",
    },
  );
  const thinking = renderSegment(
    theme,
    `Denken ${input.state.model.thinking ?? "aus"}`,
    {
      tone: "muted",
    },
  );
  const branch = input.branch ? ` git:${crop(input.branch, 16)}` : "";
  const project = renderSegment(
    theme,
    `${crop(compactCwd(input.cwd), 36)}${branch}`,
    {
      tone: "text",
      bold: true,
    },
  );
  const permission = renderSegment(theme, permissionLabel(input), {
    tone: permissionTone(input.state),
    bold: true,
  });
  const lsp = lspState(input);
  const lspSegment = renderSegment(theme, `LSP ${lsp}`, { tone: lspTone(lsp) });
  const left = `${model}${statusSeparator(theme)}${thinking}`;
  const right = `${permission}${statusSeparator(theme)}${lspSegment}`;
  const primary = joinSides(
    theme,
    `${left}${GROUP_GAP}${project}`,
    right,
    width,
  );
  const context =
    input.contextPercent === null
      ? ""
      : `${statusSeparator(theme)}Kontext ${renderContextGauge(input.contextPercent, theme)}`;
  const secondary = crop(
    theme.fg("dim", `Sitzung ${input.sessionName ?? "unbenannt"}`) +
      statusSeparator(theme) +
      theme.fg(
        "dim",
        `↑${formatTokens(input.tokens.input)} ↓${formatTokens(input.tokens.output)}`,
      ) +
      context,
    width,
  );
  return [primary, secondary];
}

function renderSubagents(
  theme: Theme,
  width: number,
  subagents: readonly SubagentInfo[],
): string[] {
  if (subagents.length === 0) return [];
  const attention = subagents.filter(
    (entry) => entry.status === "needs_attention",
  ).length;
  const suffix =
    attention > 0
      ? `${statusSeparator(theme)}${theme.fg("error", `${attention} Aufmerksamkeit`)}`
      : "";
  const summary = crop(
    `${theme.fg("accent", "⚡")} ${theme.fg("text", `${subagents.length} Subagent${subagents.length === 1 ? "" : "en"} aktiv`)}${suffix}`,
    width,
  );
  const prioritized = [...subagents].sort(
    (a, b) =>
      Number(b.status === "needs_attention") -
      Number(a.status === "needs_attention"),
  );
  const visible = prioritized.slice(0, 3);
  const details =
    subagents.length > visible.length
      ? [theme.fg("muted", `+${subagents.length - visible.length} weitere`)]
      : [];
  details.push(
    ...visible.map((entry) => {
      const tone =
        entry.status === "running"
          ? "success"
          : entry.status === "paused"
            ? "warning"
            : entry.status === "needs_attention"
              ? "error"
              : "muted";
      return `${entry.agent}${entry.phase ? ` ${entry.phase}` : ""}${statusSeparator(theme)}${theme.fg(tone, entry.status)}`;
    }),
  );
  return [summary, crop(`  ${details.join("    ")}`, width)];
}

/**
 * Three deliberate layouts: narrow protects project, permissions and warnings;
 * normal adds model plus routine diagnostics; wide adds session detail.
 */
export function renderFooterLines(
  theme: Theme,
  width: number,
  input: FooterInput,
): string[] {
  const layout: Layout = layoutFor(width);
  const lines =
    layout === "narrow"
      ? renderNarrow(theme, width, input)
      : layout === "normal"
        ? renderNormal(theme, width, input)
        : renderWide(theme, width, input);
  if (layout === "wide" && input.subagents)
    lines.push(...renderSubagents(theme, width, input.subagents));
  return lines;
}
