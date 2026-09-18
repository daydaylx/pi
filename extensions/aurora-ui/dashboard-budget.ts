import type { Layout } from "../shared/layout.ts";
import type { ActiveToolView, SubagentInfo } from "./tool-renderers.ts";
import type { DashboardMode } from "../setup-core/config.ts";

/**
 * How many tool/subagent detail rows each dashboard mode shows at a given
 * terminal size. The one invariant every caller relies on: for a fixed
 * layout, `expanded >= auto >= compact`. Previously this was two separate,
 * independently-drifting expressions inline in index.ts, and they disagreed
 * at standard/comfortable width — expanded showed fewer rows than auto.
 */
const DETAIL_LIMITS: Record<DashboardMode, Record<Layout, number>> = {
  hidden: { compact: 0, standard: 0, comfortable: 0, wide: 0 },
  compact: { compact: 0, standard: 0, comfortable: 0, wide: 0 },
  auto: { compact: 0, standard: 3, comfortable: 3, wide: 3 },
  expanded: { compact: 1, standard: 3, comfortable: 5, wide: 6 },
};

export function detailLimitFor(mode: DashboardMode, layout: Layout): number {
  return DETAIL_LIMITS[mode][layout];
}

type Candidate =
  | { kind: "tool"; score: number; item: ActiveToolView }
  | { kind: "subagent"; score: number; item: SubagentInfo };

/** Lower survives longer. A tool that is actively erroring or stalled
 * outranks a routine running one; a subagent asking for attention outranks
 * everything else in this shared budget. */
function toolScore(tool: ActiveToolView): number {
  if (tool.tone === "error") return 1;
  if (tool.tone === "warning") return 2;
  return 4;
}

function subagentScore(subagent: SubagentInfo): number {
  if (subagent.status === "needs_attention") return 0;
  // An actually running subagent is live work, ranked above a routine
  // running tool. A merely queued/paused one has not started doing anything
  // yet — background activity, ranked below even a routine tool.
  if (subagent.status === "running") return 3;
  return 5;
}

export interface ActivitySlots {
  visibleTools: ActiveToolView[];
  visibleSubagents: SubagentInfo[];
  hiddenTools: ActiveToolView[];
  hiddenSubagents: SubagentInfo[];
}

/**
 * A single shared priority order for tools and subagents, instead of giving
 * tools first claim on every slot and subagents only the leftovers. Without
 * this, a `needs_attention` subagent could be pushed out of the visible
 * budget entirely by ordinary running tools (Read, Grep, ...) even though it
 * is the one thing that actually needs the user's attention.
 */
export function selectActivitySlots(
  tools: readonly ActiveToolView[],
  subagents: readonly SubagentInfo[],
  detailLimit: number,
): ActivitySlots {
  const candidates: Candidate[] = [
    ...tools.map((item): Candidate => ({
      kind: "tool",
      score: toolScore(item),
      item,
    })),
    ...subagents.map((item): Candidate => ({
      kind: "subagent",
      score: subagentScore(item),
      item,
    })),
  ];
  // A stable sort keeps each group's original relative order among ties.
  const ranked = [...candidates].sort((a, b) => a.score - b.score);
  const limit = Math.max(0, detailLimit);
  const visibleSet = new Set(ranked.slice(0, limit));

  const visibleTools: ActiveToolView[] = [];
  const hiddenTools: ActiveToolView[] = [];
  const visibleSubagents: SubagentInfo[] = [];
  const hiddenSubagents: SubagentInfo[] = [];
  for (const candidate of candidates) {
    const visible = visibleSet.has(candidate);
    if (candidate.kind === "tool") {
      (visible ? visibleTools : hiddenTools).push(candidate.item);
    } else {
      (visible ? visibleSubagents : hiddenSubagents).push(candidate.item);
    }
  }
  return { visibleTools, visibleSubagents, hiddenTools, hiddenSubagents };
}

export interface DashboardContentInput {
  /** Optional content title. The activity tile keeps its title in the frame
   * heading and therefore leaves this unset to save a row. */
  title?: string;
  goal?: string;
  /** The task/activity tile's body lines in the caller's own priority order:
   * the live-status heading (or idle fallback) first, then tool/subagent
   * rows, then an overflow summary if any were already hidden by
   * {@link selectActivitySlots}. */
  bodyLines: readonly string[];
  /** Total tile rows available, including the two frame rows. */
  maxRows: number;
  /** What to show in place of a cut line, when the budget cannot fit
   * everything. Defaults to a generic notice; a caller with something more
   * specific to report (e.g. a subagent asking for attention that didn't
   * survive the row budget either) can say so instead — the one thing this
   * note must never do is stay generic while the actually important content
   * silently disappears. */
  overflowNote?: string;
}

export interface DashboardContentResult {
  lines: string[];
  truncated: boolean;
}

const FRAME_ROWS = 2;
const DEFAULT_OVERFLOW_NOTE = "…weitere Details ausgeblendet (zu wenig Platz)";

/**
 * Selects which content fits the tile's real row budget *before* rendering,
 * instead of rendering the full tile and slicing the finished frame (which
 * would cut the closing border off along with whatever content it dropped).
 *
 * Priority, highest first: the title and the body's first line (the live
 * status / needs-attention / error heading, already ordered by
 * {@link selectActivitySlots}) are mandatory. Everything else — the rest of
 * the body (tool/subagent rows, overflow summary) and the goal — fills the
 * remaining budget in that order, since a goal line is the one piece of
 * detail a reader can do without under real space pressure. The overflow
 * note's row is reserved up front (never added and then evicted again) so
 * the total line count can never exceed the budget.
 */
export function selectDashboardContent(
  input: DashboardContentInput,
): DashboardContentResult {
  const budget = Math.max(1, input.maxRows - FRAME_ROWS);
  const mandatory = [
    ...(input.title ? [input.title] : []),
    ...(input.bodyLines.length > 0 ? [input.bodyLines[0]!] : []),
  ];
  const optional: string[] = [
    ...input.bodyLines.slice(1),
    ...(input.goal ? [input.goal] : []),
  ];

  const truncated = mandatory.length + optional.length > budget;
  const contentBudget = truncated ? Math.max(0, budget - 1) : budget;

  const lines = mandatory.slice(0, contentBudget);
  let used = lines.length;
  for (const line of optional) {
    if (used >= contentBudget) break;
    lines.push(line);
    used += 1;
  }
  if (truncated && lines.length < budget) {
    lines.push(input.overflowNote ?? DEFAULT_OVERFLOW_NOTE);
  }

  return { lines, truncated };
}
