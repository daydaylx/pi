import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { Tone } from "../shared/ui-theme.ts";
import { crop } from "./layout.ts";

/**
 * The only background fills Aurora ever paints. Pi's public `Theme.bg` accepts
 * exactly these eight tokens, so tiles and pills stay correct in every theme
 * (including `light`) instead of hardcoding ANSI colours. The type is derived
 * from the API itself: `ThemeBg` is not exported by the package entry.
 */
export type TileFill = Parameters<Theme["bg"]>[0];

export interface TileInput {
  title: string;
  lines: readonly string[];
  badge?: string;
  tone?: "accent" | "muted" | "warning" | "error" | "success";
  /** Card background. Omit it and the tile degrades to the flat panel look. */
  fill?: TileFill;
}

/** The neutral card surface every tile uses unless a status owns its fill. */
export const NEUTRAL_TILE_FILL: TileFill = "toolPendingBg";

/**
 * Maps a status tone to the card fill that carries it. Only success and error
 * have dedicated background tokens; everything else sits on the neutral card.
 */
export function statusFill(tone: TileInput["tone"]): TileFill {
  if (tone === "success") return "toolSuccessBg";
  if (tone === "error") return "toolErrorBg";
  return NEUTRAL_TILE_FILL;
}

/**
 * A status chip. Loud tones get a filled background (or inverse, since Pi has
 * no warning background token); routine tones stay flat text so a bar of many
 * segments does not turn into a wall of colour.
 */
export function renderPill(theme: Theme, text: string, tone: Tone): string {
  switch (tone) {
    case "accent":
      return theme.bg(
        "selectedBg",
        ` ${theme.fg("accent", theme.bold(text))} `,
      );
    case "success":
      return theme.bg("toolSuccessBg", ` ${theme.fg("success", text)} `);
    case "error":
      return theme.bg(
        "toolErrorBg",
        ` ${theme.fg("error", theme.bold(text))} `,
      );
    case "warning":
      return theme.inverse(` ${theme.fg("warning", text)} `);
    default:
      return theme.fg(tone, text);
  }
}

/** Terminal cells a pill occupies: its text plus one padding cell each side. */
export function pillExtraCells(tone: Tone): number {
  return tone === "accent" ||
    tone === "success" ||
    tone === "error" ||
    tone === "warning"
    ? 2
    : 0;
}

/**
 * A labelled field row: muted uppercase label, then the value. Callers style
 * the value themselves; the tile crops the finished row to its inner width.
 */
export function renderField(
  theme: Theme,
  label: string,
  value: string,
): string {
  return `${theme.fg("muted", theme.bold(label.toUpperCase()))}  ${value}`;
}

function padFilled(
  theme: Theme,
  value: string,
  width: number,
  fill: TileFill,
): string {
  // crop closes any fg/bold left open by the truncation, so the tile fill is
  // not punctured by a stray full reset and no colour bleeds past this row
  // into the frame or a neighbouring tile.
  const clipped = crop(value, width);
  const padding = " ".repeat(Math.max(0, width - visibleWidth(clipped)));
  return `${theme.bg(fill, clipped)}${theme.bg(fill, padding)}`;
}

/** One empty, filled card row — used to equalise tile heights in a grid. */
export function tileBlankRow(
  theme: Theme,
  width: number,
  fill?: TileFill,
): string {
  const available = Math.max(1, width);
  if (!fill || available < 18) return "";
  const innerWidth = Math.max(1, available - 4);
  const border = (value: string) => theme.fg("borderMuted", value);
  return `${border("│ ")}${padFilled(theme, "", innerWidth, fill)}${border(" │")}`;
}

/** Card rows: two frame rows plus one row per content line. */
export function tileHeight(input: TileInput): number {
  return input.lines.length + 2;
}

/**
 * A filled card: the frame shell, but the title row and every content row are
 * padded to the full inner width and painted with `theme.bg`, so the card
 * reads as one solid surface. The < 18 column fallback drops the frame
 * entirely and preserves the content, as the old panel shell did.
 */
export function renderTile(
  theme: Theme,
  width: number,
  input: TileInput,
): string[] {
  const available = Math.max(1, width);
  const title = theme.fg(input.tone ?? "accent", theme.bold(input.title));
  const badge = input.badge
    ? ` ${renderPill(theme, input.badge, input.tone ?? "muted")}`
    : "";

  if (available < 18) {
    return [
      crop(`${title}${badge}`, available),
      ...input.lines.map((line) => crop(line, available)),
    ];
  }

  const innerWidth = Math.max(1, available - 4);
  const border = (value: string) => theme.fg("borderMuted", value);

  if (!input.fill) {
    // Unfilled tiles keep the classic framed look without a background.
    const heading = crop(`${title}${badge}`, innerWidth);
    const fillDashes = "─".repeat(
      Math.max(0, innerWidth - visibleWidth(heading)),
    );
    const row = (value: string) => {
      const clipped = crop(value, innerWidth);
      return `${border("│ ")}${clipped}${" ".repeat(
        Math.max(0, innerWidth - visibleWidth(clipped)),
      )}${border(" │")}`;
    };
    return [
      `${border("╭─")}${heading}${border(`${fillDashes}─╮`)}`,
      ...input.lines.map(row),
      border(`╰${"─".repeat(Math.max(1, available - 2))}╯`),
    ];
  }

  const fill = input.fill;
  const heading = padFilled(theme, `${title}${badge}`, innerWidth, fill);
  const row = (value: string) =>
    `${border("│ ")}${padFilled(theme, value, innerWidth, fill)}${border(" │")}`;

  return [
    `${border("╭─")}${heading}${border("─╮")}`,
    ...input.lines.map(row),
    border(`╰${"─".repeat(Math.max(1, available - 2))}╯`),
  ];
}

/**
 * Lays tiles out as a grid. With `columns: 2` consecutive tiles share a row:
 * both get half the width, the shorter one is padded with blank filled rows.
 * An unpaired last tile spans the full width. Widths under two framed tiles
 * degrade to a vertical stack, and a single column always stacks.
 */
export function renderTileGrid(
  theme: Theme,
  width: number,
  tiles: readonly TileInput[],
  columns: 1 | 2 = 1,
): string[] {
  const available = Math.max(1, width);
  // Two framed tiles side by side need 2 × 18 columns plus one gap column.
  const framedPairFits = available >= 37;
  if (columns !== 2 || !framedPairFits) {
    return tiles.flatMap((tile) => renderTile(theme, available, tile));
  }

  const lines: string[] = [];
  const columnWidth = Math.floor((available - 1) / 2);
  for (let index = 0; index < tiles.length; index += 2) {
    const left = tiles[index]!;
    const right = tiles[index + 1];
    if (!right) {
      lines.push(...renderTile(theme, available, left));
      continue;
    }
    const leftLines = renderTile(theme, columnWidth, left);
    const rightLines = renderTile(theme, columnWidth, right);
    const height = Math.max(leftLines.length, rightLines.length);
    for (let row = 0; row < height; row += 1) {
      const leftLine =
        leftLines[row] ?? tileBlankRow(theme, columnWidth, left.fill);
      const rightLine =
        rightLines[row] ?? tileBlankRow(theme, columnWidth, right.fill);
      lines.push(`${leftLine} ${rightLine}`);
    }
  }
  return lines;
}
