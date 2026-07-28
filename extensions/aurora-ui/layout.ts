import { truncateToWidth } from "@earendil-works/pi-tui";

/**
 * The single place that maps a terminal width to a layout tier. Every Aurora
 * surface — editor frame, footer and the activity widget — switches at exactly
 * these thresholds, so they must never be restated as literals elsewhere.
 */
export type Layout = "narrow" | "normal" | "wide";

export function layoutFor(width: number): Layout {
  if (width < 76) return "narrow";
  if (width < 124) return "normal";
  return "wide";
}

/** Width-safe truncation that accounts for ANSI escapes and wide glyphs. */
export function crop(value: string, width: number): string {
  return truncateToWidth(value, Math.max(1, width), "…");
}
