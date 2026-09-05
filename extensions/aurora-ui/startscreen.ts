import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { layoutForSize } from "../shared/layout.ts";
import { compactCwd } from "./cwd.ts";
import { crop } from "./layout.ts";
import { renderField, renderShortcutRows, renderTile } from "./tile.ts";
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

/** The welcome window never claims the full terminal — it is a dialog. */
const WELCOME_TILE_MAX_COLUMNS = 68;

/** Extra inner margin so labels don't sit flush against the frame. */
const PANEL_PADDING = 2;

function center(value: string, width: number): string {
  const clipped = crop(value, Math.max(1, width));
  return `${" ".repeat(Math.max(0, Math.floor((width - visibleWidth(clipped)) / 2)))}${clipped}`;
}

function separator(theme: Theme): string {
  return theme.fg("borderMuted", " │ ");
}

function metadata(
  theme: Theme,
  input: StartscreenInput,
  width: number,
): string {
  const model = crop(input.model ?? "kein Modell", 28);
  const values = [
    theme.fg("accent", theme.bold(input.workflow.toUpperCase())),
    theme.fg("text", model),
  ];
  if (input.thinking) values.push(renderThinkingLabel(theme, input.thinking));
  return center(values.join(separator(theme)), width);
}

/** Shortcut chips with their description, wrapped to the tile's inner width. */
function shortcutRows(theme: Theme, innerWidth: number): string[] {
  return renderShortcutRows(
    theme,
    innerWidth,
    [
      ["Shift+Tab", "Workflow"],
      ["Super+M", "Modell"],
      ["Super+D", "Denken"],
      ["Super+Q", "Befehle"],
      ["Super+S", "Rollen"],
    ].map(([key, label]) => ({ key, label })),
  );
}

/**
 * A fresh-session welcome only. Its caller owns whether the session is still
 * fresh; this function only formats values that session state already has.
 *
 * From the standard size class on the welcome is a centered dialog card with
 * labelled fields and shortcut chips; compact terminals keep three centered
 * lines so the frame does not eat the little space they have.
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

  if (layout === "compact")
    return [
      center(theme.fg("accent", theme.bold("PI · AURORA")), width),
      metadata(theme, input, width),
      center(theme.fg("muted", cwd), width),
    ];

  const tileWidth = Math.min(width, WELCOME_TILE_MAX_COLUMNS);
  const model = crop(input.model ?? "kein Modell", 28);
  const innerWidth = Math.max(1, tileWidth - PANEL_PADDING * 2 - 2);
  const tile = renderTile(theme, tileWidth, {
    title: "PI · AURORA",
    tone: "accent",
    padding: PANEL_PADDING,
    lines: [
      renderField(
        theme,
        "Workflow",
        theme.fg("accent", theme.bold(input.workflow.toUpperCase())),
      ),
      renderField(theme, "Modell", theme.fg("text", model)),
      ...(input.thinking
        ? [
            renderField(
              theme,
              "Denken",
              renderThinkingLabel(theme, input.thinking),
            ),
          ]
        : []),
      renderField(theme, "Ordner", theme.fg("muted", cwd)),
      theme.fg("borderMuted", "KURZBEFEHLE"),
      "",
      ...shortcutRows(theme, innerWidth),
    ],
  });
  return tile.map((row) => center(row, width));
}
