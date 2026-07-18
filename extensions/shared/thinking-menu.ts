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
export type ThinkingMenuSelection = "auto" | `manual:${SelectableThinkingLevel}`;

const THINKING_LEVEL_LABEL: Record<SelectableThinkingLevel, string> = {
  minimal: "Minimal",
  low: "Niedrig",
  medium: "Mittel",
  high: "Hoch",
  xhigh: "Sehr hoch",
};

const THINKING_LEVEL_DESCRIPTION: Record<SelectableThinkingLevel, string> = {
  minimal: "Kaum sichtbares Nachdenken, schnellste Antworten",
  low: "Kurzes Nachdenken für einfache Aufgaben",
  medium: "Ausgewogenes Nachdenken für normale Aufgaben",
  high: "Gründliches Nachdenken für anspruchsvolle Aufgaben",
  xhigh: "Maximales Nachdenken für die komplexesten Aufgaben",
};

export function thinkingLabel(
  mode: "auto" | "manual",
  level: ThinkingLevel,
): string {
  return mode === "auto" ? `Auto (${level})` : `Manuell (${level})`;
}

export function buildThinkingMenu(
  current: ThinkingLevel,
  mode: "auto" | "manual" = "manual",
): MenuEntry<ThinkingMenuSelection>[] {
  return [
    {
      id: "thinking-auto",
      label: "Auto",
      description: "Folgt dem Denkstandard des aktiven Workflow-Modus",
      value: "auto",
      current: mode === "auto",
    },
    ...THINKING_LEVELS.map((level) => ({
      id: `thinking-${level}`,
      label: `Manuell: ${THINKING_LEVEL_LABEL[level]}`,
      description: THINKING_LEVEL_DESCRIPTION[level],
      value: `manual:${level}` as const,
      current: mode === "manual" && current === level,
    })),
  ];
}
