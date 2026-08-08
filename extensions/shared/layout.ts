/**
 * The single definition of the terminal size classes every Pi surface uses.
 *
 * Before this module there were two: the menu shell switched at 52/90 columns
 * (counting rows as well), the Aurora chrome at 76/124 (columns only). Two
 * surfaces therefore disagreed about what "narrow" meant, and neither boundary
 * was stated anywhere a third surface could find it.
 *
 * This file deliberately imports nothing. `menu-ui.ts` notes that a static
 * `pi-tui` import breaks the jiti test loader, and every menu module reaches
 * these thresholds — keeping the size math dependency-free means importing it
 * can never pull a renderer into a module that must stay loadable.
 */

/**
 * A — compact: single-line entries, no descriptions, no detail area.
 * B — standard: one description line per entry.
 * C — comfortable: two description lines plus a detail area.
 * D — wide: room for the optional extras; no surface may claim it permanently.
 */
export type Layout = "compact" | "standard" | "comfortable" | "wide";

export const LAYOUT_COLUMNS = {
  standard: 52,
  comfortable: 90,
  wide: 120,
} as const;

export const LAYOUT_ROWS = {
  standard: 14,
  comfortable: 28,
  wide: 30,
} as const;

/** Below this width an overlay gives up its outer margin to gain content. */
const TIGHT_MARGIN_COLUMNS = 36;

/**
 * The size class of a full terminal. Both dimensions must clear a threshold:
 * a 200×10 terminal is compact, because height is what the entry lists and
 * detail areas actually spend.
 */
export function layoutForSize(columns: number, rows: number): Layout {
  if (columns < LAYOUT_COLUMNS.standard || rows < LAYOUT_ROWS.standard)
    return "compact";
  if (columns >= LAYOUT_COLUMNS.wide && rows >= LAYOUT_ROWS.wide) return "wide";
  if (
    columns >= LAYOUT_COLUMNS.comfortable &&
    rows >= LAYOUT_ROWS.comfortable
  )
    return "comfortable";
  return "standard";
}

/**
 * The size class of a single-line surface. The footer occupies one row at any
 * height, so only its width can decide how much it may say.
 */
export function footerTier(columns: number): Layout {
  if (columns < LAYOUT_COLUMNS.standard) return "compact";
  if (columns >= LAYOUT_COLUMNS.wide) return "wide";
  if (columns >= LAYOUT_COLUMNS.comfortable) return "comfortable";
  return "standard";
}

/** The outer gap an overlay leaves on every side of the terminal. */
export function overlayMargin(columns: number, rows: number): 1 | 2 {
  return columns < TIGHT_MARGIN_COLUMNS || rows < LAYOUT_ROWS.standard ? 1 : 2;
}
