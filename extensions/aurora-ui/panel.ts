import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { crop } from "./layout.ts";

export interface PanelInput {
  title: string;
  lines: readonly string[];
  badge?: string;
  tone?: "accent" | "muted" | "warning" | "error" | "success";
}

/**
 * Shared, width-safe panel shell for Aurora's persistent and on-demand TUI
 * surfaces. It deliberately uses foreground colours and light box drawing only:
 * Pi's public widget API does not expose a general panel background.
 */
export function renderPanel(
  theme: Theme,
  width: number,
  input: PanelInput,
): string[] {
  const available = Math.max(1, width);
  const title = theme.fg(
    input.tone ?? "accent",
    theme.bold(input.title),
  );
  const badge = input.badge ? ` ${theme.fg(input.tone ?? "muted", input.badge)}` : "";

  // A frame would consume most of an exceptionally narrow terminal. Preserve
  // the information instead of emitting broken corners or clipped rails.
  if (available < 18) {
    return [
      crop(`${title}${badge}`, available),
      ...input.lines.map((line) => crop(line, available)),
    ];
  }

  const innerWidth = Math.max(1, available - 4);
  const heading = crop(`${title}${badge}`, innerWidth);
  const fill = "─".repeat(Math.max(0, innerWidth - visibleWidth(heading)));
  const border = (value: string) => theme.fg("borderMuted", value);
  const row = (value: string) => {
    const clipped = crop(value, innerWidth);
    return `${border("│ ")}${clipped}${" ".repeat(
      Math.max(0, innerWidth - visibleWidth(clipped)),
    )}${border(" │")}`;
  };

  return [
    `${border("╭─")}${heading}${border(`${fill}─╮`)}`,
    ...input.lines.map(row),
    border(`╰${"─".repeat(Math.max(1, available - 2))}╯`),
  ];
}
