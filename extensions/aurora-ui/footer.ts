import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { footerTier, type Layout } from "../shared/layout.ts";
import {
  renderSegment,
  STATUS_SEPARATOR,
  statusSeparator,
  type Tone,
} from "../shared/ui-theme.ts";
import { compactCwd } from "./cwd.ts";
import { crop } from "./layout.ts";
import type { AuroraUiState } from "./state.ts";
import { pillExtraCells, renderPill } from "./tile.ts";
import { thinkingLabel, thinkingTone } from "./thinking.ts";
import {
  normalizeVerificationLabel,
  verificationDisplayLabel,
} from "./verification-normalize.ts";

/**
 * The footer is the one permanent status surface, and it is one line.
 *
 * Everything it reports comes out of runtime state that some other extension
 * already publishes on the Aurora bus or through `getExtensionStatuses()`.
 * Nothing here starts a process, probes git or the LSP, asks a provider or
 * touches the file system: `render` is called on every frame, so any of that
 * would be paid for continuously and for nothing.
 */
export interface FooterInput {
  state: AuroraUiState;
  statuses: ReadonlyMap<string, string>;
  contextPercent: number | null;
  /** Captured from ExtensionContext at session start; never read from render I/O. */
  cwd?: string;
  homeDirectory?: string;
  /** True while a Session panel surface (auto/compact/expanded) is active. It
   * owns routine verification reporting; workflow identity remains visible in
   * the footer as the permanent status-bar anchor. */
  dashboardVisible?: boolean;
}

const CONTEXT_WARNING_PERCENT = 70;
const CONTEXT_CRITICAL_PERCENT = 90;
const MODEL_MAX_COLUMNS = 32;
const FOLDER_MAX_COLUMNS: Record<Layout, number> = {
  wide: 34,
  comfortable: 24,
  standard: 14,
  compact: 10,
};

/**
 * Where a segment sits on the line. Reading order is fixed and independent of
 * how hard the segment fights to stay: risk is loud, but it belongs at the end
 * where a scan finishes, not wedged between the model and the thinking level.
 * A plain object rather than a `const enum` — the test loader transpiles
 * without type information.
 */
const Slot = {
  workflow: 0,
  model: 1,
  thinking: 2,
  folder: 3,
  changes: 4,
  context: 5,
  verification: 6,
  risk: 7,
} as const;

type Slot = (typeof Slot)[keyof typeof Slot];

/**
 * What gets dropped first when the line is too long — lowest survives longest.
 * The workflow is last man standing. Everything that reports an actual problem
 * outranks the model name: at the widths where this matters the user knows
 * which model they picked, and does not yet know their language server died.
 */
const Priority = {
  workflow: 0,
  yolo: 1,
  recovery: 2,
  failedVerification: 3,
  exhaustedContext: 4,
  lsp: 5,
  folder: 6,
  changes: 8,
  model: 7,
  verification: 9,
  thinking: 10,
  context: 11,
} as const;

type Priority = (typeof Priority)[keyof typeof Priority];

/**
 * Three classes, in survival order:
 * - `orientation` (workflow, folder): the permanent anchors. Never removed,
 *   only cropped — losing the current workflow or working directory is worse
 *   than losing any amount of metadata.
 * - `risk` (YOLO, recovery, failed verification, degraded LSP, exhausted
 *   context): ignores the width tier. Several at once aggregate into one
 *   visible count rather than being dropped one by one until only the
 *   luckiest-priority risk survives.
 * - `metadata` (model, thinking, changes, routine context/verification):
 *   routine information, dropped first and individually when space is tight.
 */
type SegmentClass = "orientation" | "risk" | "metadata";

interface Segment {
  slot: Slot;
  priority: Priority;
  text: string;
  tone: Tone;
  bold?: boolean;
  class: SegmentClass;
}

/** Which routine segments each width tier may show at all. */
const ROUTINE_TIERS: Record<Layout, ReadonlySet<Slot>> = {
  wide: new Set([
    Slot.workflow,
    Slot.model,
    Slot.thinking,
    Slot.folder,
    Slot.changes,
    Slot.context,
    Slot.verification,
  ]),
  comfortable: new Set([
    Slot.workflow,
    Slot.model,
    Slot.thinking,
    Slot.folder,
    Slot.changes,
    Slot.context,
    Slot.verification,
  ]),
  standard: new Set([Slot.workflow, Slot.model, Slot.thinking, Slot.folder]),
  compact: new Set([Slot.workflow, Slot.model, Slot.folder]),
};

function verificationState(input: FooterInput): string | null {
  return normalizeVerificationLabel(input.statuses.get("verification"));
}

function verificationTone(state: string): Tone {
  if (state === "verified") return "success";
  if (state === "unchanged") return "muted";
  if (state === "checks_failed") return "error";
  return "warning";
}

/** Only an unproven or failing workspace is worth defending space for. */
function verificationNeedsAttention(state: string | null): boolean {
  return state !== null && state !== "unchanged" && state !== "verified";
}

function lspState(input: FooterInput): string {
  return input.statuses.get("lsp") ?? input.state.lsp.state ?? "—";
}

/**
 * A working, idle or disabled language server is not news, so it stays off the
 * line entirely. Only a degraded one is, and it claims space at any width.
 *
 * `extensions/lsp/status.ts` publishes a closed set: `aus`, `leerlauf`,
 * `eingeschränkt` and `${n} aktiv`. Matching the one bad value is what keeps
 * `3 aktiv` — a perfectly healthy server count — out of the warning slot.
 */
function lspNeedsAttention(state: string): boolean {
  return state === "eingeschränkt";
}

function collectSegments(input: FooterInput, width: number): Segment[] {
  const tier = footerTier(width);
  const segments: Segment[] = [];
  segments.push({
    slot: Slot.workflow,
    priority: Priority.workflow,
    text: input.state.workflow.label,
    tone: "accent",
    bold: true,
    class: "orientation",
  });
  segments.push({
    slot: Slot.model,
    priority: Priority.model,
    // The real runtime model id. Prettifying it into a marketing name would
    // mean inventing a mapping the runtime never gave us.
    text: crop(input.state.model.id ?? "kein Modell", MODEL_MAX_COLUMNS),
    tone: "text",
    class: "metadata",
  });

  if (input.state.model.thinking) {
    segments.push({
      slot: Slot.thinking,
      priority: Priority.thinking,
      text: `Denken ${thinkingLabel(input.state.model.thinking)}`,
      tone: thinkingTone(input.state.model.thinking),
      bold: true,
      class: "metadata",
    });
  }

  if (input.cwd) {
    segments.push({
      slot: Slot.folder,
      priority: Priority.folder,
      text: compactCwd(
        input.cwd,
        FOLDER_MAX_COLUMNS[tier],
        input.homeDirectory,
      ),
      tone: "muted",
      class: "orientation",
    });
  }

  if (input.state.changes) {
    segments.push({
      slot: Slot.changes,
      priority: Priority.changes,
      text: `Änderungen ${input.state.changes.filesCount} · +${input.state.changes.linesAdded}/−${input.state.changes.linesRemoved}`,
      tone: "muted",
      class: "metadata",
    });
  }

  if (input.contextPercent !== null) {
    // Colour and layout priority are separate judgements. A filling context is
    // worth a warning colour long before it is worth taking a narrow line's
    // space away from the workflow — only a nearly exhausted one is urgent
    // enough to outrank the tier it would normally be filtered out by.
    const exhausted = input.contextPercent >= CONTEXT_CRITICAL_PERCENT;
    segments.push({
      slot: Slot.context,
      priority: exhausted ? Priority.exhaustedContext : Priority.context,
      text: `Kontext ${Math.round(input.contextPercent)}%`,
      tone: exhausted
        ? "error"
        : input.contextPercent >= CONTEXT_WARNING_PERCENT
          ? "warning"
          : "muted",
      class: exhausted ? "risk" : "metadata",
    });
  }

  const verification = verificationState(input);
  if (verification !== null) {
    const attention = verificationNeedsAttention(verification);
    // Ownership rule: a successful check belongs to the visible dashboard
    // (or the inspector when auto mode shows nothing right now); the footer
    // only carries verification that demands attention.
    const ownedByDashboard = input.dashboardVisible === true && !attention;
    if (!ownedByDashboard) {
      segments.push({
        slot: Slot.verification,
        priority: attention
          ? Priority.failedVerification
          : Priority.verification,
        text: `${verification === "verified" ? "✓" : attention ? "⚠" : ""} ${verificationDisplayLabel(verification)}`.trim(),
        tone: verificationTone(verification),
        // Without a dashboard surface owning the verdict, the routine success
        // stays visible in the footer — but it is not a risk: it keeps normal
        // priority and yields to real risks on narrow lines like any metadata.
        class: attention ? "risk" : "metadata",
      });
    }
  }

  const lsp = lspState(input);
  if (lspNeedsAttention(lsp)) {
    segments.push({
      slot: Slot.risk,
      priority: Priority.lsp,
      text: `⚠ LSP ${lsp}`,
      tone: "error",
      class: "risk",
    });
  }

  const yoloLevel = input.state.permissions.level;
  if (yoloLevel === "yolo" || yoloLevel === "yolo-ask" || yoloLevel === "yolo-full") {
    segments.push({
      slot: Slot.risk,
      priority: Priority.yolo,
      text:
        yoloLevel === "yolo-ask"
          ? "⚠ YOLO 2"
          : yoloLevel === "yolo-full"
            ? "⚠ YOLO 3"
            : "⚠ YOLO",
      tone: "error",
      bold: true,
      class: "risk",
    });
  }

  const recovery = input.statuses.get("recovery");
  if (recovery) {
    // Eine offene Recovery-Sperre ist eine aktive Schreibgrenze und bleibt
    // deshalb unabhängig von der Breite sichtbar.
    segments.push({
      slot: Slot.risk,
      priority: Priority.recovery,
      text: recovery,
      tone: "error",
      bold: true,
      class: "risk",
    });
  }

  return segments;
}

/**
 * Terminal cells, not JavaScript characters. `⚠`, `✓`, CJK and emoji all cost
 * more cells than they do string length, and a selection that measured length
 * would believe a line fits and then have to truncate a finished segment at
 * the edge — the one thing this layout exists to avoid. Pills pay their two
 * padding cells here too, so the width budget sees exactly what renders.
 */
function widthOf(segments: readonly Segment[], pillTier: boolean): number {
  if (segments.length === 0) return 0;
  return (
    segments.reduce(
      (total, segment) =>
        total + visibleWidth(segment.text) + segmentCells(segment, pillTier),
      0,
    ) +
    visibleWidth(STATUS_SEPARATOR) * (segments.length - 1)
  );
}

/** Whether the footer renders segments as filled pills at this tier. */
function isPillTier(tier: Layout): boolean {
  return tier === "comfortable" || tier === "wide";
}

/**
 * Whether this segment renders as a pill when the tier allows it: workflow
 * identity and every critical risk; routine metadata never does. Shared by
 * the width budget (`segmentCells`) and the actual render decision below, so
 * the two can never silently drift apart.
 */
function isPillSegment(segment: Segment): boolean {
  return segment.class === "risk" || segment.slot === Slot.workflow;
}

/** The extra cells a segment pays when it renders as a filled pill. */
function segmentCells(segment: Segment, pillTier: boolean): number {
  if (!pillTier || !isPillSegment(segment)) return 0;
  return pillExtraCells(segment.tone);
}

/**
 * Orientation and risk segments are never subject to the width tier at all;
 * only metadata is. While the line is still too wide, metadata gives way
 * first, one segment at a time by priority — exactly as before. If orientation
 * plus every individual risk still doesn't fit once metadata is gone, the
 * risks collapse into one aggregated count instead of being dropped one by
 * one until only the luckiest-priority risk survives (which used to make
 * `critical` a lie: it only protected a segment from the tier filter, not
 * from this very loop). Segments give up their place entirely rather than
 * being shaved at the edge, and survivors are put back into reading order,
 * which is not the order they were selected in.
 */
function selectFooterSegments(
  segments: readonly Segment[],
  width: number,
): Segment[] {
  const tier = footerTier(width);
  const pillTier = isPillTier(tier);
  const allowed = ROUTINE_TIERS[tier];
  const kept = segments.filter(
    (segment) => segment.class !== "metadata" || allowed.has(segment.slot),
  );

  while (
    kept.length > 1 &&
    widthOf(kept, pillTier) > width &&
    kept.some((segment) => segment.class === "metadata")
  ) {
    let victim = -1;
    for (let index = 0; index < kept.length; index += 1) {
      if (kept[index]!.class !== "metadata") continue;
      if (victim === -1 || kept[index]!.priority > kept[victim]!.priority)
        victim = index;
    }
    if (victim === -1) break;
    kept.splice(victim, 1);
  }

  if (widthOf(kept, pillTier) > width) {
    const risks = kept.filter((segment) => segment.class === "risk");
    if (risks.length > 1) {
      const rest = kept.filter((segment) => segment.class !== "risk");
      const worstPriority = Math.min(
        ...risks.map((r) => r.priority),
      ) as Priority;
      rest.push({
        slot: Slot.risk,
        priority: worstPriority,
        text: `⚠ ${risks.length}`,
        tone: "error",
        bold: true,
        class: "risk",
      });
      return rest.sort((a, b) => a.slot - b.slot);
    }
  }

  return kept.sort((a, b) => a.slot - b.slot);
}

export function renderFooterLines(
  theme: Theme,
  width: number,
  input: FooterInput,
): string[] {
  const available = Math.max(1, width);
  const selected = selectFooterSegments(
    collectSegments(input, available),
    available,
  );
  // From comfortable width on, the workflow identity and every risk read as
  // filled chips; routine metadata stays flat so the line never turns into a
  // wall of colour. Narrow tiers keep the flat look entirely.
  const pillTier = isPillTier(footerTier(available));
  const line = selected
    .map((segment) =>
      pillTier && isPillSegment(segment)
        ? renderPill(theme, segment.text, segment.tone)
        : renderSegment(theme, segment.text, {
            tone: segment.tone,
            bold: segment.bold,
          }),
    )
    .join(statusSeparator(theme));
  return [visibleWidth(line) > available ? crop(line, available) : line];
}
