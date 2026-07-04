import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { MenuEntry } from "./menu-ui.ts";

export const THINKING_LEVELS = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;

export type SelectableThinkingLevel = (typeof THINKING_LEVELS)[number];

const THINKING_LEVEL_LABEL: Record<SelectableThinkingLevel, string> = {
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "XHigh",
};

const THINKING_LEVEL_DESCRIPTION: Record<SelectableThinkingLevel, string> = {
  minimal: "Kaum sichtbares Nachdenken, schnellste Antworten",
  low: "Kurzes Nachdenken für einfache Aufgaben",
  medium: "Ausgewogenes Nachdenken für normale Aufgaben",
  high: "Gründliches Nachdenken für anspruchsvolle Aufgaben",
  xhigh: "Maximales Nachdenken für die komplexesten Aufgaben",
};

export function buildThinkingMenu(
  current: ThinkingLevel,
): MenuEntry<SelectableThinkingLevel>[] {
  return THINKING_LEVELS.map((level) => ({
    id: `thinking-${level}`,
    label: THINKING_LEVEL_LABEL[level],
    description: THINKING_LEVEL_DESCRIPTION[level],
    value: level,
    current: current === level,
  }));
}
