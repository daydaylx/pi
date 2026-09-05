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
  /** Card background. Omit it and the tile keeps the flat, frame-only look. */
  fill?: TileFill;
  /** Columns of blank margin between the frame and content, each side. Defaults to 1. */
  padding?: number;
}

/**
 * Maps a status tone to the card fill that carries it. Only success and error
 * have dedicated background tokens; every other tone stays frame-only, so a
 * routine or pending card never paints a highlight background.
 */
export function statusFill(tone: TileInput["tone"]): TileFill | undefined {
  if (tone === "success") return "toolSuccessBg";
  if (tone === "error") return "toolErrorBg";
  return undefined;
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
      // toolPendingBg looks like the free slot since c72c29f dropped it as the
      // default card fill, but it isn't: Pi core paints every pending tool-call
      // box with it (tool-execution.js), and in aurora-night it resolves to the
      // same value as userMessageBg — a warning chip on it would read as a flat
      // chat bubble. warning's hue (ochre) also sits only ~9° from accent's
      // (copper), so a second fill token wouldn't reliably read as distinct
      // from an accent chip anyway. inverse() gives a theme-independent,
      // guaranteed fg/bg swap instead.
      return theme.inverse(` ${theme.fg("warning", text)} `);
    default:
      return theme.fg(tone, text);
  }
}

export interface ShortcutItem {
  key: string;
  label: string;
}

/** One key cap and its description, grouped into a single filled chip. */
function renderShortcutChip(
  theme: Theme,
  key: string,
  label: string,
  contentWidth: number,
): string {
  const raw = `${key} ${label}`;
  const fillPad = " ".repeat(Math.max(0, contentWidth - raw.length));
  return theme.bg(
    "selectedBg",
    ` ${theme.bold(theme.fg("accent", key))} ${theme.fg("muted", label)}${fillPad} `,
  );
}

/**
 * Renders key hints as a grid of equal-width chips, each pairing a key cap
 * with its description as one visual unit (background and all), so "which
 * key goes with which label" never has to be guessed from adjacency alone.
 * Every chip shares one column width — the widest pair's — so row 2's chips
 * land under row 1's columns instead of a greedy wrap staggering them.
 */
export function renderShortcutRows(
  theme: Theme,
  width: number,
  shortcuts: readonly ShortcutItem[],
): string[] {
  const available = Math.max(1, width);
  if (shortcuts.length === 0) return [];

  const contentWidth = Math.max(
    ...shortcuts.map(({ key, label }) => `${key} ${label}`.length),
  );
  const chipWidth = contentWidth + 2; // one padding cell each side, inside the fill
  const gap = 2;
  const columns = Math.max(
    1,
    Math.min(
      shortcuts.length,
      Math.floor((available + gap) / (chipWidth + gap)),
    ),
  );

  const chips = shortcuts.map(({ key, label }) =>
    crop(renderShortcutChip(theme, key, label, contentWidth), available),
  );

  const rows: string[] = [];
  for (let index = 0; index < chips.length; index += columns) {
    rows.push(chips.slice(index, index + columns).join(" ".repeat(gap)));
  }
  return rows;
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

/**
 * A title row reserves its badge first.  The earlier `${title}${badge}` crop
 * made a long title consume the entire row and leave the state badge absent,
 * even though the badge is the more useful scan target.
 */
function renderTileHeading(
  theme: Theme,
  title: string,
  badge: string | undefined,
  titleTone: NonNullable<TileInput["tone"]>,
  badgeTone: NonNullable<TileInput["tone"]>,
  width: number,
): string {
  const available = Math.max(1, width);
  const renderedBadge = badge ? ` ${renderPill(theme, badge, badgeTone)}` : "";
  const titleWidth = Math.max(1, available - visibleWidth(renderedBadge));
  const renderedTitle = crop(
    theme.fg(titleTone, theme.bold(title)),
    titleWidth,
  );
  return `${renderedTitle}${renderedBadge}`;
}

/** One empty card row — used to equalise tile heights in a grid. */
export function tileBlankRow(
  theme: Theme,
  width: number,
  fill?: TileFill,
): string {
  const available = Math.max(1, width);
  if (available < 18) return "";
  const innerWidth = Math.max(1, available - 4);
  const border = (value: string) => theme.fg("borderMuted", value);
  const content = fill
    ? padFilled(theme, "", innerWidth, fill)
    : " ".repeat(innerWidth);
  return `${border("│ ")}${content}${border(" │")}`;
}

/** Card rows: two frame rows plus one row per content line. */
export function tileHeight(input: TileInput): number {
  return input.lines.length + 2;
}

/**
 * A card: a frame shell around the title and content lines. A `fill` paints
 * every row's inner width with `theme.bg` so the card reads as one solid
 * surface; without one, the card stays frame-only with a plain background.
 * The < 18 column fallback drops the frame entirely and preserves the
 * content, as the old panel shell did. The title sits in the top frame row
 * itself, with one column of breathing room on each side so it never butts
 * straight against the corner dash.
 */
export function renderTile(
  theme: Theme,
  width: number,
  input: TileInput,
): string[] {
  const available = Math.max(1, width);
  const titleTone = input.tone ?? "accent";
  const badgeTone = input.tone ?? "muted";
  const border = (value: string) => theme.fg("borderMuted", value);
  const cornerLeft = border("╭─");
  const cornerRight = border("─╮");
  const titleBudget = Math.max(
    1,
    available - visibleWidth(cornerLeft) - visibleWidth(cornerRight) - 2,
  );
  const heading = renderTileHeading(
    theme,
    input.title,
    input.badge,
    titleTone,
    badgeTone,
    titleBudget,
  );

  if (available < 18) {
    return [
      crop(heading, available),
      ...input.lines.map((line) => crop(line, available)),
    ];
  }

  const padding = Math.max(1, Math.floor(input.padding ?? 1));
  const pad = " ".repeat(padding);
  const innerWidth = Math.max(1, available - padding * 2 - 2);
  const clippedHeading = crop(heading, titleBudget);
  const dashesWidth = Math.max(0, titleBudget - visibleWidth(clippedHeading));
  const headingRow = `${cornerLeft}${border(" ")}${clippedHeading}${border(
    ` ${"─".repeat(dashesWidth)}`,
  )}${cornerRight}`;

  if (!input.fill) {
    // Unfilled tiles keep the classic framed look without a background.
    const row = (value: string) => {
      const clipped = crop(value, innerWidth);
      return `${border(`│${pad}`)}${clipped}${" ".repeat(
        Math.max(0, innerWidth - visibleWidth(clipped)),
      )}${border(`${pad}│`)}`;
    };
    return [
      headingRow,
      ...input.lines.map(row),
      border(`╰${"─".repeat(Math.max(1, available - 2))}╯`),
    ];
  }

  const fill = input.fill;
  const filledHeading = padFilled(theme, ` ${heading}`, innerWidth, fill);
  const row = (value: string) =>
    `${border(`│${pad}`)}${padFilled(theme, value, innerWidth, fill)}${border(`${pad}│`)}`;

  return [
    `${cornerLeft}${filledHeading}${cornerRight}`,
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
  // Split the content width exactly. Using the same floored width for both
  // sides used to leave the final cell blank whenever `available` was even,
  // making a pair of filled cards look like their frames and backgrounds had
  // different right boundaries.
  const leftWidth = Math.floor((available - 1) / 2);
  const rightWidth = available - leftWidth - 1;
  for (let index = 0; index < tiles.length; index += 2) {
    const left = tiles[index]!;
    const right = tiles[index + 1];
    if (!right) {
      lines.push(...renderTile(theme, available, left));
      continue;
    }
    const leftLines = renderTile(theme, leftWidth, left);
    const rightLines = renderTile(theme, rightWidth, right);
    const height = Math.max(leftLines.length, rightLines.length);
    for (let row = 0; row < height; row += 1) {
      const leftLine =
        leftLines[row] ?? tileBlankRow(theme, leftWidth, left.fill);
      const rightLine =
        rightLines[row] ?? tileBlankRow(theme, rightWidth, right.fill);
      lines.push(`${leftLine} ${rightLine}`);
    }
  }
  return lines;
}
