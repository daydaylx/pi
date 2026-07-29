import { homedir } from "node:os";
import { isAbsolute, normalize, relative, sep } from "node:path";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { renderSegment } from "../shared/ui-theme.ts";
import { crop, layoutFor, type Layout } from "./layout.ts";
import type { AuroraUiState } from "./state.ts";

/**
 * Since Aurora reduced the editor frame to workflow and step, the footer is the
 * only place that reports model, thinking level, project, permissions, LSP and
 * context. Nothing here may be duplicated by another surface.
 */
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

/**
 * Order in which segments give up their place when the line does not fit.
 * Dropping whole segments keeps the remaining ones readable; cropping the
 * joined line instead would shave characters off whatever happens to sit at
 * the edge. Permissions, project and model never drop — they are the reason
 * the footer exists.
 */
const DROP_ORDER = ["thinking", "workflow", "lsp", "branch"] as const;
type Droppable = (typeof DROP_ORDER)[number];

const SEPARATOR = " │ ";
const GROUP_GAP = "   ";

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
  const color = percent >= 90 ? "error" : percent >= 70 ? "warning" : "success";
  return `${theme.fg(color, bar)} ${theme.fg(color, `${Math.round(percent)}%`)}`;
}

function joinSides(left: string, right: string, width: number): string {
  const available = Math.max(1, width);
  const gap = available - visibleWidth(left) - visibleWidth(right);
  if (gap >= 1) return left + " ".repeat(gap) + right;
  if (available < 52) return crop(`${left}${SEPARATOR}${right}`, available);
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

/**
 * The permission mode, not the bash policy. `permissions/session-state.ts`
 * answers Aurora's state request with the short German mode label, which is
 * what belongs here — the `permissions` status key instead carries a risk
 * banner ("🛡 DEFAULT · PROJECT WRITE") that is far too wide for one segment.
 */
function permissionLabel(input: FooterInput): string {
  return input.state.permissions.label ?? "—";
}

interface Blocks {
  left: string;
  center: string;
  right: string;
}

function buildBlocks(
  theme: Theme,
  input: FooterInput,
  layout: Layout,
  dropped: ReadonlySet<Droppable>,
): Blocks {
  const { state } = input;
  const modelWidth = layout === "wide" ? 32 : 18;
  const projectWidth = layout === "wide" ? 36 : 24;

  const left = [
    renderSegment(theme, crop(state.model.id ?? "kein Modell", modelWidth), {
      tone: "accent",
    }),
  ];
  if (!dropped.has("thinking") && layout !== "narrow") {
    left.push(
      renderSegment(theme, `Denken ${state.model.thinking ?? "aus"}`, {
        tone: "muted",
      }),
    );
  }

  const branchText =
    input.branch && !dropped.has("branch")
      ? ` git:${crop(input.branch, 16)}`
      : "";
  const center = renderSegment(
    theme,
    `${crop(compactCwd(input.cwd), projectWidth)}${branchText}`,
    { tone: "text", bold: true },
  );

  const right: string[] = [];
  if (!dropped.has("workflow") && layout === "wide") {
    right.push(
      renderSegment(
        theme,
        input.statuses.get("workflow") ?? state.workflow.label,
        { tone: "muted" },
      ),
    );
  }
  right.push(
    renderSegment(theme, permissionLabel(input), {
      tone: "warning",
      bold: true,
    }),
  );
  const lsp = input.statuses.get("lsp") ?? state.lsp.state ?? "—";
  if (!dropped.has("lsp") && layout !== "narrow") {
    right.push(
      renderSegment(theme, `LSP ${lsp}`, {
        tone: lsp === "eingeschränkt" ? "error" : "success",
      }),
    );
  }

  const sep = theme.fg("borderMuted", SEPARATOR);
  return {
    left: left.join(sep),
    center,
    right: right.join(sep),
  };
}

function blocksWidth(blocks: Blocks): number {
  return (
    visibleWidth(blocks.left) +
    visibleWidth(blocks.center) +
    visibleWidth(blocks.right) +
    visibleWidth(GROUP_GAP) * 2
  );
}

function layoutLine(blocks: Blocks, layout: Layout, width: number): string {
  if (layout === "wide" && blocksWidth(blocks) + 2 <= width) {
    // Three balanced columns: the project sits centred between model and status.
    const leftW = visibleWidth(blocks.left);
    const centerW = visibleWidth(blocks.center);
    const rightW = visibleWidth(blocks.right);
    const slack = width - leftW - centerW - rightW;
    const spaceLeft = Math.max(1, Math.floor(slack / 2));
    const spaceRight = Math.max(1, slack - spaceLeft);
    return crop(
      blocks.left +
        " ".repeat(spaceLeft) +
        blocks.center +
        " ".repeat(spaceRight) +
        blocks.right,
      width,
    );
  }
  return joinSides(
    `${blocks.left}${GROUP_GAP}${blocks.center}`,
    blocks.right,
    width,
  );
}

export function renderFooterLines(
  theme: Theme,
  width: number,
  input: FooterInput,
): string[] {
  const layout = layoutFor(width);
  const dropped = new Set<Droppable>();
  let blocks = buildBlocks(theme, input, layout, dropped);
  for (const candidate of DROP_ORDER) {
    if (blocksWidth(blocks) <= width) break;
    dropped.add(candidate);
    blocks = buildBlocks(theme, input, layout, dropped);
  }

  const lines = [layoutLine(blocks, layout, width)];
  if (layout === "wide") {
    const gauge =
      input.contextPercent === null
        ? ""
        : `${SEPARATOR}Kontext ${renderContextGauge(input.contextPercent, theme)}`;
    lines.push(
      crop(
        theme.fg(
          "dim",
          `Sitzung ${input.sessionName ?? "unbenannt"}${SEPARATOR}↑${formatTokens(input.tokens.input)} ↓${formatTokens(input.tokens.output)}`,
        ) + gauge,
        width,
      ),
    );

    // Subagenten-Zeilen (nur wenn aktiv)
    if (input.subagents && input.subagents.length > 0) {
      const count = input.subagents.length;
      const summary = crop(
        `${theme.fg("accent", "⚡")} ${theme.fg("text", `${count} Subagent${count === 1 ? "" : "en"} aktiv`)}`,
        width,
      );
      lines.push(summary);

      const details = input.subagents
        .slice(0, 3)
        .map((sa) => {
          const parts = [sa.agent];
          if (sa.phase) parts.push(sa.phase);
          const statusColor =
            sa.status === "running"
              ? "success"
              : sa.status === "paused"
                ? "warning"
                : sa.status === "needs_attention"
                  ? "error"
                  : "muted";
          parts.push(theme.fg(statusColor, sa.status));
          return parts.join(" · ");
        })
        .join("    ");
      const truncated =
        input.subagents.length > 3 ? `  ${theme.fg("muted", "...")}` : "";
      lines.push(
        crop(`  ${theme.fg("muted", details)}${truncated}`, width),
      );
    }
  }
  return lines;
}
