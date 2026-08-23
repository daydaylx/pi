import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { crop } from "./layout.ts";

export interface InspectorSection {
  title: string;
  lines: string[];
  tone?: "accent" | "muted" | "warning" | "error" | "success";
}

export interface InspectorContent {
  title: string;
  badge?: string;
  sections: InspectorSection[];
  actions?: Array<{ label: string; key?: string }>;
}

export function renderInspectorBox(
  content: InspectorContent,
  theme: Theme,
  width: number,
): string[] {
  const boxWidth = Math.min(width, 76);
  const innerWidth = Math.max(1, boxWidth - 4);
  const lines: string[] = [];

  const topBorder = `┌─ ${theme.bold(content.title)}${content.badge ? ` [${content.badge}]` : ""} ${"─".repeat(Math.max(1, boxWidth - visibleWidth(content.title) - (content.badge ? visibleWidth(content.badge) + 3 : 0) - 5))}┐`;
  lines.push(crop(topBorder, width));

  lines.push(crop(`│ ${" ".repeat(innerWidth)} │`, width));

  for (const section of content.sections) {
    if (section.title) {
      const header = `${theme.fg(section.tone ?? "accent", theme.bold(section.title))}`;
      lines.push(crop(`│  ${header}${" ".repeat(Math.max(0, innerWidth - visibleWidth(section.title) - 1))}│`, width));
    }
    for (const line of section.lines) {
      lines.push(crop(`│   ${line}${" ".repeat(Math.max(0, innerWidth - visibleWidth(line) - 2))}│`, width));
    }
    lines.push(crop(`│ ${" ".repeat(innerWidth)} │`, width));
  }

  if (content.actions && content.actions.length > 0) {
    const actionText = content.actions
      .map((a) => `[${a.label}${a.key ? ` (${a.key})` : ""}]`)
      .join("  ");
    lines.push(crop(`│  ${theme.fg("muted", actionText)}${" ".repeat(Math.max(0, innerWidth - visibleWidth(actionText) - 1))}│`, width));
    lines.push(crop(`│ ${" ".repeat(innerWidth)} │`, width));
  }

  const bottomBorder = `└${"─".repeat(boxWidth - 2)}┘`;
  lines.push(crop(bottomBorder, width));

  return lines;
}
