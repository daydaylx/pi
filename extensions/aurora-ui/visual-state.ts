import type { Theme } from "@earendil-works/pi-coding-agent";
import type { MotionMode } from "../setup-core/config.ts";
import type { Tone } from "../shared/ui-theme.ts";

/** Runtime states that carry a distinct visual meaning in Aurora. */
export type VisualState =
  | "idle"
  | "thinking"
  | "working"
  | "responding"
  | "waiting"
  | "verifying"
  | "success"
  | "warning"
  | "error"
  | "attention";

export type VisualMotion = "none" | "fast" | "medium" | "slow" | "stream";

export interface StateVisual {
  tone: Tone;
  glyph: string;
  motion: VisualMotion;
  /** Static fallback used by reduced motion and the no-animation mode. */
  staticGlyph: string;
}

/**
 * Pi's public ThemeColor union is intentionally closed. Forge therefore uses
 * the existing semantic slots as stable adapters: accent is working,
 * thinkingHigh is thinking, thinkingMax is responding and thinkingXhigh is
 * verification. The palette files give those slots Forge-specific values.
 */
const STATE_VISUALS: Record<VisualState, StateVisual> = {
  idle: { tone: "muted", glyph: "·", staticGlyph: "·", motion: "none" },
  thinking: {
    tone: "thinkingHigh",
    glyph: "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏",
    staticGlyph: "●",
    motion: "fast",
  },
  working: {
    tone: "accent",
    glyph: "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏",
    staticGlyph: "●",
    motion: "fast",
  },
  responding: {
    tone: "thinkingMax",
    glyph: "▸▸›▸››▸",
    staticGlyph: "▸",
    motion: "stream",
  },
  waiting: {
    tone: "muted",
    glyph: "○◌●◌",
    staticGlyph: "○",
    motion: "slow",
  },
  verifying: {
    tone: "thinkingXhigh",
    glyph: "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏",
    staticGlyph: "◌",
    motion: "medium",
  },
  success: { tone: "success", glyph: "✓", staticGlyph: "✓", motion: "none" },
  warning: { tone: "warning", glyph: "!", staticGlyph: "!", motion: "none" },
  error: { tone: "error", glyph: "✕", staticGlyph: "✕", motion: "none" },
  attention: {
    tone: "error",
    glyph: "!",
    staticGlyph: "!",
    motion: "none",
  },
};

export function visualForState(state: VisualState): StateVisual {
  return STATE_VISUALS[state];
}

export function visualStateForActivity(
  activity:
    | "idle"
    | "thinking"
    | "tool"
    | "working"
    | "responding"
    | "waiting"
    | "verifying",
): VisualState {
  return activity === "tool" ? "working" : activity;
}

/**
 * Selects one shared-ticker frame. Expressive mode animates all states that
 * have a useful motion profile; contextual only animates active fast work;
 * reduced and off never expose time-based animation.
 */
export function renderVisualGlyph(
  theme: Theme,
  state: VisualState,
  motion: MotionMode,
  frame: number,
): string {
  const visual = visualForState(state);
  if (motion === "off" || visual.motion === "none") return "";
  if (motion === "reduced") return theme.fg(visual.tone, visual.staticGlyph);
  if (motion === "contextual" && visual.motion !== "fast") {
    return theme.fg(visual.tone, visual.staticGlyph);
  }

  const speed =
    visual.motion === "fast"
      ? 1
      : visual.motion === "medium"
        ? 3
        : visual.motion === "slow"
          ? 8
          : 2;
  const index = Math.floor(frame / speed) % visual.glyph.length;
  return theme.fg(visual.tone, visual.glyph[index] ?? visual.staticGlyph);
}

export function visualTone(state: VisualState): Tone {
  return visualForState(state).tone;
}

