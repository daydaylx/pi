import type { Theme } from "@earendil-works/pi-coding-agent";

/**
 * The subset of Pi's `ThemeColor` that this repository's chrome uses. Every
 * value here must exist in the Pi theme schema — `Theme.fg` throws on unknown
 * keys.
 *
 * Backgrounds are allowed, but only through `aurora-ui/tile.ts` (tiles and
 * pills): Pi's `Theme.bg` accepts exactly eight fixed surfaces, and the tile
 * primitives map tones onto them, so every theme (including `light`) stays
 * correct. Flat segments in this module never paint a background.
 */
export type Tone =
  | "accent"
  | "warning"
  | "success"
  | "error"
  | "muted"
  | "dim"
  | "text"
  | "border"
  | "borderMuted"
  | "thinkingOff"
  | "thinkingMinimal"
  | "thinkingLow"
  | "thinkingMedium"
  | "thinkingHigh"
  | "thinkingXhigh"
  | "thinkingMax";

/**
 * Renders one status segment for a TUI bar. Segments are told apart by their
 * foreground color and by the separator their caller places between them; on
 * wide tiers callers may upgrade individual segments to pills via
 * `aurora-ui/tile.ts`, but the default stays a flat, background-free run.
 */
export function renderSegment(
  theme: Theme,
  text: string,
  options: { tone?: Tone; icon?: string; bold?: boolean } = {},
): string {
  const { tone = "text", icon, bold = false } = options;
  const content = icon ? `${icon} ${text}` : text;
  return theme.fg(tone, bold ? theme.bold(content) : content);
}

/**
 * The one separator glyph every status bar (footer, menu hint lines) joins
 * its segments with. A raw, unstyled `" · "`/`" │ "` next to this themed one
 * reads as a third, unintended color — every caller must go through here.
 */
export const STATUS_SEPARATOR = " │ ";

export function statusSeparator(theme: Theme): string {
  return theme.fg("borderMuted", STATUS_SEPARATOR);
}
