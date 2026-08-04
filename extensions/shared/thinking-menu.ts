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
  return `Manuell (${level})`;
}

export function buildThinkingMenu(
  current: ThinkingLevel,
): MenuEntry<SelectableThinkingLevel>[] {
  return THINKING_LEVELS.map((level) => ({
    id: `thinking-${level}`,
    label: `Manuell: ${THINKING_LEVEL_LABEL[level]}`,
    description: THINKING_LEVEL_DESCRIPTION[level],
    value: level,
    current: current === level,
  }));
}
