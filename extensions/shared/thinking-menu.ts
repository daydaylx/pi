import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { MenuEntry } from "./menu-ui.ts";

export const THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;

export type SelectableThinkingLevel = (typeof THINKING_LEVELS)[number];

export function isSelectableThinkingLevel(
  value: unknown,
): value is SelectableThinkingLevel {
  return THINKING_LEVELS.includes(value as SelectableThinkingLevel);
}

/** Manual selection is the only mode there is, so no label says so. */
const THINKING_LEVEL_LABEL: Record<SelectableThinkingLevel, string> = {
  off: "Aus",
  minimal: "Minimal",
  low: "Niedrig",
  medium: "Mittel",
  high: "Hoch",
  xhigh: "Sehr hoch",
};

const THINKING_LEVEL_DESCRIPTION: Record<SelectableThinkingLevel, string> = {
  off: "Kein erweitertes Denken für diese Antwort",
  minimal: "Kaum sichtbares Nachdenken, schnellste Antworten",
  low: "Kurzes Nachdenken für einfache Aufgaben",
  medium: "Ausgewogenes Nachdenken für normale Aufgaben",
  high: "Gründliches Nachdenken für anspruchsvolle Aufgaben",
  xhigh: "Maximales Nachdenken für die komplexesten Aufgaben",
};

export function thinkingLabel(level: ThinkingLevel): string {
  return isSelectableThinkingLevel(level)
    ? THINKING_LEVEL_LABEL[level]
    : String(level);
}

/**
 * A level the active model does not implement is shown disabled rather than
 * hidden: the list then always describes the same six steps, and the gap says
 * "this model cannot" instead of silently renumbering the scale.
 */
export function buildThinkingMenu(
  current: ThinkingLevel,
  supports: (level: SelectableThinkingLevel) => boolean = () => true,
): MenuEntry<SelectableThinkingLevel>[] {
  return THINKING_LEVELS.map((level) => {
    const supported = supports(level);
    return {
      id: `thinking-${level}`,
      label: THINKING_LEVEL_LABEL[level],
      description: THINKING_LEVEL_DESCRIPTION[level],
      value: level,
      current: current === level,
      disabled: !supported,
      ...(supported
        ? {}
        : { disabledReason: "Dieses Modell unterstützt die Stufe nicht." }),
    };
  });
}
