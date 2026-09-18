import type { Theme } from "@earendil-works/pi-coding-agent";
import { LAYOUT_COLUMNS } from "../shared/layout.ts";
import { renderTile } from "./tile.ts";

/**
 * An upper bound, not a fixed width: the inspector otherwise grows to fill
 * arbitrarily wide terminals, which reads worse than a bounded card even
 * when the space exists. Real narrow terminals still get their real width
 * (see the `Math.min` below) — this only ever caps the wide end.
 */
const MAX_INSPECTOR_COLUMNS = LAYOUT_COLUMNS.wide;

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
  return renderTile(theme, Math.min(width, MAX_INSPECTOR_COLUMNS), {
    title: content.title,
    badge: content.badge,
    lines,
  });
}
