import type { Theme } from "@earendil-works/pi-coding-agent";

/**
 * The subset of Pi's `ThemeColor` that this repository's chrome uses. Every
 * value here must exist in the Pi theme schema — `Theme.fg` throws on unknown
 * keys. A background option is deliberately not offered: `ThemeBg` accepts only
 * the six message and tool surfaces, none of which mean "status segment".
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
  | "borderMuted";

/**
 * Renders one status segment for a TUI bar. Segments are told apart by their
 * foreground color and by the separator their caller places between them, not
 * by a background fill.
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
