import type { Theme } from "@earendil-works/pi-coding-agent";

export type Tone = "accent" | "warning" | "success" | "error" | "muted" | "dim" | "text" | "border" | "borderMuted";

/**
 * Renders a visually distinct "pill" or badge for TUI bars and overlays.
 */
export function renderPill(
  theme: Theme,
  text: string,
  options: {
    tone?: Tone;
    icon?: string;
    bold?: boolean;
    bg?: string;
  } = {},
): string {
  const { tone = "text", icon, bold = false, bg } = options;
  const content = icon ? `${icon} ${text}` : text;
  const styledContent = bold ? theme.bold(content) : content;

  const themed = theme as unknown as { bg?: (color: string, text: string) => string };
  if (bg && typeof themed.bg === "function") {
    try {
      return themed.bg(bg, ` ${theme.fg(tone as never, styledContent)} `);
    } catch {
      // Fallback if background token is invalid
    }
  }

  // Fallback visual pill using brackets and foreground colors
  return theme.fg("borderMuted" as never, "[") + theme.fg(tone as never, styledContent) + theme.fg("borderMuted" as never, "]");
}

/**
 * Creates an empty line padded with side borders for dialog vertical spacing ("breathing space").
 */
export function emptyBorderLine(theme: Theme, innerWidth: number, tone: Tone = "border"): string {
  const borderChar = theme.fg(tone as never, "│");
  return `${borderChar}${" ".repeat(Math.max(0, innerWidth))}${borderChar}`;
}

/**
 * Creates a top or bottom border frame line with optional inner padding.
 */
export function renderFrameBorder(
  theme: Theme,
  innerWidth: number,
  position: "top" | "bottom" | "divider",
  tone: Tone = "border",
): string {
  const chars = {
    top: { left: "╭", right: "╮" },
    bottom: { left: "╰", right: "╯" },
    divider: { left: "├", right: "┤" },
  }[position];

  const left = theme.fg(tone as never, chars.left);
  const right = theme.fg(tone as never, chars.right);
  const line = theme.fg(tone as never, "─".repeat(Math.max(0, innerWidth)));
  return `${left}${line}${right}`;
}

/**
 * Formats a menu item selection with strong visual focus.
 */
export function formatSelectionRow(
  theme: Theme,
  rowText: string,
  width: number,
  isSelected: boolean,
  padFn: (text: string, width: number) => string,
): string {
  const padded = padFn(rowText, width);
  if (!isSelected) return padded;

  const themed = theme as unknown as {
    bg?: (color: "selectedBg" | string, text: string) => string;
    inverse?: (text: string) => string;
  };

  if (typeof themed.bg === "function") {
    try {
      return themed.bg("selectedBg", padded);
    } catch {
      // Fallback below
    }
  }

  if (typeof themed.inverse === "function") {
    return themed.inverse(padded);
  }

  return theme.fg("accent" as never, theme.bold(padded));
}
