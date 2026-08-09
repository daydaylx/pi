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

const LABEL_BY_LEVEL: Record<string, string> = {
  off: "AUS",
  minimal: "MINIMAL",
  low: "NIEDRIG",
  medium: "MITTEL",
  high: "HOCH",
  xhigh: "XHIGH",
};

/** The configured thinking level is display-only; unknown values stay muted. */
export function thinkingTone(level: string | undefined): ThinkingTone | "muted" {
  return TONE_BY_LEVEL[level?.toLowerCase() ?? ""] ?? "muted";
}

/** Visible German labels; unknown configured values remain descriptive, not rated. */
export function thinkingLabel(level: string | undefined): string {
  const normalized = level?.toLowerCase();
  return normalized
    ? (LABEL_BY_LEVEL[normalized] ?? level?.toUpperCase() ?? "AUS")
    : "AUS";
}

export function renderThinkingLabel(
  theme: Theme,
  level: string | undefined,
): string {
  return theme.fg(thinkingTone(level), thinkingLabel(level));
}
