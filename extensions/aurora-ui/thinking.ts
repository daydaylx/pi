import type { Theme } from "@earendil-works/pi-coding-agent";

export type ThinkingTone =
  | "thinkingOff"
  | "thinkingMinimal"
  | "thinkingLow"
  | "thinkingMedium"
  | "thinkingHigh"
  | "thinkingXhigh";

const TONE_BY_LEVEL: Record<string, ThinkingTone> = {
  off: "thinkingOff",
  minimal: "thinkingMinimal",
  low: "thinkingLow",
  medium: "thinkingMedium",
  high: "thinkingHigh",
  xhigh: "thinkingXhigh",
};

/** The configured thinking level is display-only; unknown values stay muted. */
export function thinkingTone(level: string | undefined): ThinkingTone | "muted" {
  return TONE_BY_LEVEL[level?.toLowerCase() ?? ""] ?? "muted";
}

export function thinkingLabel(level: string | undefined): string {
  return (level || "off").toUpperCase();
}

export function renderThinkingLabel(
  theme: Theme,
  level: string | undefined,
): string {
  return theme.fg(thinkingTone(level), thinkingLabel(level));
}
