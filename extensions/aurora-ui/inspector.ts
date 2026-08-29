import type { Theme } from "@earendil-works/pi-coding-agent";
import { renderTile } from "./tile.ts";

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
  const lines: string[] = [];
  for (const section of content.sections) {
    if (section.title) {
      lines.push(theme.fg(section.tone ?? "accent", theme.bold(section.title)));
    }
    lines.push(...section.lines.map((line) => `  ${line}`));
  }
  if (content.actions && content.actions.length > 0) {
    const actionText = content.actions
      .map((action) => `${action.label}${action.key ? ` · ${action.key}` : ""}`)
      .join("   ");
    lines.push(theme.fg("muted", actionText));
  }
  return renderTile(theme, Math.min(width, 76), {
    title: content.title,
    badge: content.badge,
    fill: "toolPendingBg",
    lines,
  });
}
