import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { layoutForSize } from "../shared/layout.ts";
import { compactCwd } from "./cwd.ts";
import { renderThinkingLabel } from "./thinking.ts";

export interface StartscreenInput {
  width: number;
  rows: number;
  workflow: string;
  model?: string;
  thinking?: string;
  cwd: string;
  homeDirectory?: string;
}

const WORDMARK = [
  " █████╗ ██╗   ██╗██████╗  ██████╗ ██████╗ ",
  "██╔══██╗██║   ██║██╔══██╗██╔═══██╗██╔══██╗",
  "███████║██║   ██║██████╔╝██║   ██║██████╔╝",
  "██╔══██║██║   ██║██╔══██╗██║   ██║██╔══██╗ ",
  "██║  ██║╚██████╔╝██║  ██║╚██████╔╝██║  ██║ ",
];

function center(value: string, width: number): string {
  const clipped = truncateToWidth(value, Math.max(1, width), "…");
  return `${" ".repeat(Math.max(0, Math.floor((width - visibleWidth(clipped)) / 2)))}${clipped}`;
}

function separator(theme: Theme): string {
  return theme.fg("borderMuted", " │ ");
}

function metadata(theme: Theme, input: StartscreenInput, width: number): string {
  const model = truncateToWidth(input.model ?? "kein Modell", 28, "…");
  const values = [
    theme.fg("accent", theme.bold(input.workflow.toUpperCase())),
    theme.fg("text", model),
  ];
  if (input.thinking) values.push(renderThinkingLabel(theme, input.thinking));
  return center(values.join(separator(theme)), width);
}

/**
 * A fresh-session welcome only. Its caller owns whether the session is still
 * fresh; this function only formats values that session state already has.
 */
export function renderStartscreen(
  theme: Theme,
  input: StartscreenInput,
): string[] {
  const width = Math.max(1, input.width);
  const layout = layoutForSize(width, input.rows);
  const cwd = compactCwd(
    input.cwd,
    layout === "compact" ? 20 : layout === "standard" ? 34 : 48,
    input.homeDirectory,
  );
  const folder = center(theme.fg("muted", cwd), width);

  if (layout === "compact")
    return [
      center(theme.fg("accent", theme.bold("PI · AURORA")), width),
      metadata(theme, input, width),
      folder,
    ];

  const shortcuts = [
    "Shift+Tab  Workflow",
    "Super+M    Model",
    "Super+D    Thinking",
    "Super+Q    Command Center",
  ].map((line) => center(theme.fg("dim", line), width));

  if (layout === "standard")
    return [
      center(theme.fg("accent", theme.bold("PI · AURORA")), width),
      "",
      metadata(theme, input, width),
      folder,
      "",
      ...shortcuts,
    ];

  return [
    ...WORDMARK.map((line) => center(theme.fg("border", line), width)),
    center(theme.fg("accent", theme.bold("A U R O R A")), width),
    "",
    metadata(theme, input, width),
    folder,
    "",
    ...shortcuts,
  ];
}
