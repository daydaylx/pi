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
import { thinkingLabel, thinkingTone } from "./thinking.ts";

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
  context: 4,
  verification: 5,
  risk: 6,
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
  model: 7,
  verification: 8,
  thinking: 9,
  context: 10,
} as const;

type Priority = (typeof Priority)[keyof typeof Priority];

interface Segment {
  slot: Slot;
  priority: Priority;
  text: string;
  tone: Tone;
  bold?: boolean;
  /**
   * A segment that reports a risk or a failure. It ignores the width tier,
   * because a footer that hides YOLO or a failed verification to save four
   * columns is worse than one that has to drop something else.
   */
  critical?: boolean;
}

/** Which routine segments each width tier may show at all. */
const ROUTINE_TIERS: Record<Layout, ReadonlySet<Slot>> = {
  wide: new Set([
    Slot.workflow,
    Slot.model,
    Slot.thinking,
    Slot.folder,
    Slot.context,
    Slot.verification,
  ]),
  comfortable: new Set([
    Slot.workflow,
    Slot.model,
    Slot.thinking,
    Slot.folder,
    Slot.context,
    Slot.verification,
  ]),
  standard: new Set([Slot.workflow, Slot.model, Slot.thinking, Slot.folder]),
  compact: new Set([Slot.workflow, Slot.model, Slot.folder]),
};

function verificationState(input: FooterInput): string | null {
  const value = input.statuses.get("verification");
  return value ? value.replace(/^Verify:\s*/, "") : null;
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
  const segments: Segment[] = [
    {
      slot: Slot.workflow,
      priority: Priority.workflow,
      text: input.state.workflow.label,
      tone: "accent",
      bold: true,
    },
    {
      slot: Slot.model,
      priority: Priority.model,
      // The real runtime model id. Prettifying it into a marketing name would
      // mean inventing a mapping the runtime never gave us.
      text: crop(input.state.model.id ?? "kein Modell", MODEL_MAX_COLUMNS),
      tone: "text",
    },
  ];

  if (input.state.model.thinking) {
    segments.push({
      slot: Slot.thinking,
      priority: Priority.thinking,
      text: `Denken ${thinkingLabel(input.state.model.thinking)}`,
      tone: thinkingTone(input.state.model.thinking),
      bold: true,
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
      critical: exhausted,
    });
  }

  const verification = verificationState(input);
  if (verification !== null) {
    const attention = verificationNeedsAttention(verification);
    segments.push({
      slot: Slot.verification,
      priority: attention ? Priority.failedVerification : Priority.verification,
      text: `${verification === "verified" ? "✓" : attention ? "⚠" : ""} ${verification}`.trim(),
      tone: verificationTone(verification),
      critical: attention,
    });
  }

  const lsp = lspState(input);
  if (lspNeedsAttention(lsp)) {
    segments.push({
      slot: Slot.risk,
      priority: Priority.lsp,
      text: `⚠ LSP ${lsp}`,
      tone: "error",
      critical: true,
    });
  }

  if (input.state.permissions.level === "yolo") {
    segments.push({
      slot: Slot.risk,
      priority: Priority.yolo,
      text: "⚠ YOLO",
      tone: "error",
      bold: true,
      critical: true,
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
      critical: true,
    });
  }

  return segments;
}

/**
 * Terminal cells, not JavaScript characters. `⚠`, `✓`, CJK and emoji all cost
 * more cells than they do string length, and a selection that measured length
 * would believe a line fits and then have to truncate a finished segment at
 * the edge — the one thing this layout exists to avoid.
 */
function widthOf(segments: readonly Segment[]): number {
  if (segments.length === 0) return 0;
  return (
    segments.reduce((total, segment) => total + visibleWidth(segment.text), 0) +
    visibleWidth(STATUS_SEPARATOR) * (segments.length - 1)
  );
}

/**
 * Keep what the width tier allows plus everything critical, then, while the
 * result is still too wide, drop the least important segment that is left.
 * Segments give up their place entirely rather than being shaved at the edge,
 * so whatever remains stays readable — and the survivors are then put back
 * into reading order, which is not the order they were dropped in.
 */
function selectFooterSegments(
  segments: readonly Segment[],
  width: number,
): Segment[] {
  const allowed = ROUTINE_TIERS[footerTier(width)];
  const kept = segments.filter(
    (segment) => segment.critical || allowed.has(segment.slot),
  );
  while (kept.length > 1 && widthOf(kept) > width) {
    let victim = 0;
    for (let index = 1; index < kept.length; index += 1)
      if (kept[index]!.priority > kept[victim]!.priority) victim = index;
    kept.splice(victim, 1);
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
  const line = selected
    .map((segment) =>
      renderSegment(theme, segment.text, {
        tone: segment.tone,
        bold: segment.bold,
      }),
    )
    .join(statusSeparator(theme));
  return [visibleWidth(line) > available ? crop(line, available) : line];
}
