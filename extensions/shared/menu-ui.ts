import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

// `@earendil-works/pi-tui` is intentionally imported dynamically inside
// selectWithCustomUi() below, guarded by a `ctx.ui.custom` capability check,
// rather than as a static top-level import here. A static value-import from
// an npm package makes this file (and anything importing it, e.g.
// mode-permissions.ts) unloadable by the tests/run.mjs jiti
// harness in this environment (bare-specifier resolution walks up to a
// broken /home/d/package.json and crashes). The dynamic import only ever
// executes when a real ctx.ui.custom is available (real TUI), which the
// capability check guarantees.

export interface MenuEntry<T> {
  id: string;
  label: string;
  description: string;
  section?: string;
  current?: boolean;
  value: T;
}

export function initialMenuIndex<T>(entries: MenuEntry<T>[]): number {
  const current = entries.findIndex((entry) => entry.current);
  return current >= 0 ? current : entries.length > 0 ? 0 : -1;
}

export function moveMenuIndex(
  current: number,
  delta: number,
  count: number,
): number {
  if (current < 0 || count === 0) return -1;
  return (current + delta + count) % count;
}

const MENU_MIN_WIDTH = 42;
const MENU_MAX_WIDTH_FRACTION = 0.75;
const MENU_MARGIN = 2;
const MENU_GLYPHS = {
  selected: "●",
  unselected: "○",
  cursor: "›",
  ellipsis: "…",
} as const;

type MenuDensity = "compact" | "medium" | "comfortable";

function menuDensity(width: number): MenuDensity {
  if (width < 56) return "compact";
  if (width < 88) return "medium";
  return "comfortable";
}

function menuMargin(terminalWidth: number, terminalRows: number): number {
  return Math.min(
    MENU_MARGIN,
    Math.max(0, Math.floor((Math.min(terminalWidth, terminalRows) - 1) / 2)),
  );
}

export interface MenuViewport {
  start: number;
  end: number;
  showAbove: boolean;
  showBelow: boolean;
  contentLineBudget: number;
}

/** Calculates a terminal-safe overlay width from the actual menu content. */
export function menuOverlayWidth<T>(
  terminalWidth: number,
  title: string,
  entries: MenuEntry<T>[],
): number {
  const safeTerminalWidth = Math.max(1, Math.floor(terminalWidth));
  const available = Math.max(1, safeTerminalWidth - MENU_MARGIN * 2);
  const maximum = Math.max(
    1,
    Math.min(available, Math.floor(safeTerminalWidth * MENU_MAX_WIDTH_FRACTION)),
  );
  const minimum = Math.min(MENU_MIN_WIDTH, maximum);
  const contentWidth = Math.max(
    title.length + 8,
    ...entries.flatMap((entry) => [
      entry.label.length + (entry.current ? 12 : 8),
      entry.description.length + 6,
      (entry.section?.length ?? 0) + 6,
    ]),
  );
  return Math.max(minimum, Math.min(maximum, contentWidth));
}

/**
 * Returns a contiguous entry range whose rendered lines, plus optional rest
 * indicators, fit into `maxLines`. The selected entry is always in the range.
 */
export function calculateMenuViewport(
  entryLineCounts: number[],
  selectedIndex: number,
  preferredStart: number,
  maxLines: number,
): MenuViewport {
  if (entryLineCounts.length === 0 || selectedIndex < 0) {
    return {
      start: 0,
      end: 0,
      showAbove: false,
      showBelow: false,
      contentLineBudget: Math.max(0, maxLines),
    };
  }

  const count = entryLineCounts.length;
  const selected = Math.max(0, Math.min(count - 1, selectedIndex));
  const lineBudget = Math.max(1, Math.floor(maxLines));
  let start = Math.max(0, Math.min(selected, preferredStart));

  const fitFrom = (candidateStart: number): MenuViewport => {
    const showAbove = candidateStart > 0 && lineBudget >= 2;
    const availableAfterTop = lineBudget - (showAbove ? 1 : 0);
    let used = 0;
    let end = candidateStart;

    while (end < count) {
      const entryLines = Math.max(1, entryLineCounts[end] ?? 1);
      const canShowBelow = end < count - 1 && availableAfterTop >= 2;
      const bottomReservation = canShowBelow ? 1 : 0;
      if (used + entryLines + bottomReservation <= availableAfterTop) {
        used += entryLines;
        end += 1;
        continue;
      }

      // A single large entry still gets one visible line. The renderer keeps
      // its selection line and drops description/header lines as necessary.
      if (end === candidateStart) end += 1;
      break;
    }

    const showBelow = end < count && availableAfterTop >= 2;
    return {
      start: candidateStart,
      end,
      showAbove,
      showBelow,
      contentLineBudget: Math.max(
        1,
        lineBudget - (showAbove ? 1 : 0) - (showBelow ? 1 : 0),
      ),
    };
  };

  let viewport = fitFrom(start);
  while (selected >= viewport.end && start < selected) {
    start += 1;
    viewport = fitFrom(start);
  }
  return viewport;
}

export async function selectMenuEntry<T>(
  entries: MenuEntry<T>[],
  customPicker: () => Promise<MenuEntry<T> | undefined>,
  fallbackPicker: (labels: string[]) => Promise<string | undefined>,
): Promise<MenuEntry<T> | undefined> {
  try {
    return await customPicker();
  } catch {
    const labels = entries.map((entry) =>
      entry.section ? `${entry.section}: ${entry.label}` : entry.label,
    );
    const choice = await fallbackPicker(labels);
    const index = choice ? labels.indexOf(choice) : -1;
    return index >= 0 ? entries[index] : undefined;
  }
}

async function selectWithCustomUi<T>(
  ctx: ExtensionContext,
  title: string,
  entries: MenuEntry<T>[],
): Promise<MenuEntry<T> | undefined> {
  if (typeof ctx.ui.custom !== "function") {
    throw new Error("Benutzerdefiniertes TUI-Overlay wird nicht unterstützt.");
  }
  const { Key, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } =
    await import("@earendil-works/pi-tui");

  let terminalSize = () => ({
    columns: process.stdout.columns ?? 80,
    rows: process.stdout.rows ?? 24,
  });

  return ctx.ui.custom<MenuEntry<T> | undefined>(
    (tui, theme, _keybindings, done) => {
      let selectedIndex = initialMenuIndex(entries);
      let viewportStart = 0;
      let visibleEntryCount = 1;

      terminalSize = () => ({
        columns: tui.terminal.columns,
        rows: tui.terminal.rows,
      });

      const refresh = () => tui.requestRender();
      const move = (delta: number) => {
        if (selectedIndex < 0) return;
        const previous = selectedIndex;
        selectedIndex = moveMenuIndex(selectedIndex, delta, entries.length);
        if (
          (delta > 0 && selectedIndex < previous) ||
          (delta < 0 && selectedIndex > previous)
        ) {
          viewportStart = selectedIndex;
        }
        refresh();
      };

      interface MenuBlock {
        lines: string[];
        selectionLine: number;
      }

      const buildMenuBlocks = (
        innerWidth: number,
        density: MenuDensity,
      ): MenuBlock[] => {
        const blocks: MenuBlock[] = [];
        let lastSection: string | undefined;

        for (let index = 0; index < entries.length; index += 1) {
          const entry = entries[index];
          const lines: string[] = [];
          if (entry.section !== undefined && entry.section !== lastSection) {
            lines.push(theme.fg("dim", theme.bold(entry.section.toUpperCase())));
            lastSection = entry.section;
          }

          const selected = index === selectedIndex;
          const marker = entry.current
            ? MENU_GLYPHS.selected
            : MENU_GLYPHS.unselected;
          const cursor = selected ? `${MENU_GLYPHS.cursor} ` : "  ";
          const textColor = selected ? "accent" : "text";
          const activeLabel = entry.current ? " [aktiv]" : "";
          const titleText = `${cursor}${marker} ${entry.label}${activeLabel}`;
          const selectionLine = lines.length;
          const styledTitle = theme.fg(
            textColor,
            selected ? theme.bold(titleText) : titleText,
          );
          const fittedTitle = truncateToWidth(
            styledTitle,
            innerWidth,
            MENU_GLYPHS.ellipsis,
          );

          if (density === "compact") {
            const descWidth = Math.max(
              12,
              innerWidth - visibleWidth(titleText) - 3,
            );
            const desc = truncateToWidth(
              entry.description,
              descWidth,
              MENU_GLYPHS.ellipsis,
            );
            const separator = "—";
            lines.push(
              descWidth >= 12 && visibleWidth(titleText) + 4 < innerWidth
                ? `${styledTitle} ${theme.fg("muted", separator)} ${theme.fg("muted", desc)}`
                : fittedTitle,
            );
            blocks.push({ lines, selectionLine });
            continue;
          }

          lines.push(fittedTitle);
          if (density === "medium") {
            lines.push(
              `  ${theme.fg("muted", truncateToWidth(entry.description, Math.max(1, innerWidth - 2), MENU_GLYPHS.ellipsis))}`,
            );
            blocks.push({ lines, selectionLine });
            continue;
          }

          const wrapped = wrapTextWithAnsi(
            theme.fg("muted", entry.description),
            Math.max(1, innerWidth - 2),
          );
          for (let i = 0; i < wrapped.length && i < 3; i += 1) {
            lines.push(`  ${wrapped[i]}`);
          }
          if (wrapped.length > 3) {
            lines.push(
              theme.fg(
                "dim",
                `  ${truncateToWidth(`${MENU_GLYPHS.ellipsis} ${wrapped.length - 3} weitere Zeile(n)`, Math.max(1, innerWidth - 2), MENU_GLYPHS.ellipsis)}`,
              ),
            );
          }
          blocks.push({ lines, selectionLine });
        }

        return blocks;
      };

      const fitBlock = (block: MenuBlock, budget: number): string[] => {
        if (block.lines.length <= budget) return block.lines;
        if (budget <= 1) return [block.lines[block.selectionLine]];

        const fitted: string[] = [];
        if (block.selectionLine > 0) fitted.push(block.lines[0]);
        fitted.push(block.lines[block.selectionLine]);
        for (
          let index = block.selectionLine + 1;
          index < block.lines.length && fitted.length < budget;
          index += 1
        ) {
          fitted.push(block.lines[index]);
        }
        return fitted.slice(0, budget);
      };

      const restIndicator = (
        direction: "above" | "below",
        count: number,
      ): string => {
        const arrow = direction === "above" ? "↑" : "↓";
        return theme.fg("dim", `${arrow} ${count} weitere Einträge`);
      };

      const inputHint = (density: MenuDensity): string => {
        if (density === "compact") return "↑↓ · Enter · Esc";
        if (density === "medium") return "↑↓ wählen · PgUp/PgDn · Enter · Esc";
        return "↑↓ wählen · PgUp/PgDn blättern · Home/End springen · Enter übernehmen · Esc schließen";
      };

      return {
        render(width: number): string[] {
          if (width < 12) {
            return [theme.fg("warning", "Terminal zu schmal")];
          }
          const innerWidth = Math.max(1, width - 2);
          const density = menuDensity(width);
          const blocks = buildMenuBlocks(innerWidth, density);
          const hint = inputHint(density);
          const hintLines = wrapTextWithAnsi(hint, innerWidth);
          const availableHeight = Math.max(
            1,
            tui.terminal.rows - MENU_MARGIN * 2,
          );
          // Top/bottom frame, header divider and footer divider consume four
          // rows. The footer may wrap, so its actual height is subtracted too.
          const menuLineBudget = Math.max(
            1,
            availableHeight - hintLines.length - 4,
          );
          const viewport = calculateMenuViewport(
            blocks.map((block) => block.lines.length),
            selectedIndex,
            viewportStart,
            menuLineBudget,
          );
          viewportStart = viewport.start;
          visibleEntryCount = Math.max(1, viewport.end - viewport.start);

          const menuLines: string[] = [];
          if (viewport.showAbove) {
            menuLines.push(
              restIndicator("above", viewport.start),
            );
          }

          let remaining = viewport.contentLineBudget;
          for (
            let index = viewport.start;
            index < viewport.end && remaining > 0;
            index += 1
          ) {
            const fitted = fitBlock(blocks[index], remaining);
            menuLines.push(...fitted);
            remaining -= fitted.length;
          }

          if (viewport.showBelow) {
            menuLines.push(
              restIndicator(
                "below",
                entries.length - viewport.end,
              ),
            );
          }

          return [
            theme.fg("accent", "─".repeat(Math.max(1, width))),
            theme.fg("accent", theme.bold(truncateToWidth(title, width, MENU_GLYPHS.ellipsis))),
            ...menuLines,
            theme.fg("accent", "─".repeat(Math.max(1, width))),
            ...hintLines.map((line) => theme.fg("dim", line)),
            theme.fg("accent", "─".repeat(Math.max(1, width))),
          ];
        },
        invalidate() {},
        handleInput(data: string): void {
          if (matchesKey(data, Key.up)) {
            move(-1);
          } else if (matchesKey(data, Key.down)) {
            move(1);
          } else if (matchesKey(data, Key.pageUp)) {
            selectedIndex = Math.max(0, selectedIndex - visibleEntryCount);
            viewportStart = selectedIndex;
            refresh();
          } else if (matchesKey(data, Key.pageDown)) {
            selectedIndex = Math.min(
              entries.length - 1,
              selectedIndex + visibleEntryCount,
            );
            refresh();
          } else if (matchesKey(data, Key.home)) {
            selectedIndex = entries.length > 0 ? 0 : -1;
            viewportStart = 0;
            refresh();
          } else if (matchesKey(data, Key.end)) {
            selectedIndex = entries.length - 1;
            viewportStart = Math.max(0, selectedIndex);
            refresh();
          } else if (matchesKey(data, Key.enter)) {
            if (selectedIndex >= 0) done(entries[selectedIndex]);
          } else if (
            matchesKey(data, Key.escape) ||
            matchesKey(data, Key.ctrl("c"))
          ) {
            done(undefined);
          }
        },
      };
    },
    {
      overlay: true,
      overlayOptions: () => {
        const terminal = terminalSize();
        const width = menuOverlayWidth(terminal.columns, title, entries);
        const margin = menuMargin(terminal.columns, terminal.rows);
        return {
          anchor: "center",
          width,
          minWidth: Math.min(MENU_MIN_WIDTH, width),
          maxHeight: Math.max(1, terminal.rows - margin * 2),
          margin,
        };
      },
    },
  );
}

export interface RunMenuOptions {
  /** Prompt used by the non-TUI select() fallback. Defaults to `title`. */
  fallbackPrompt?: string;
  /** Notification shown when no interactive UI is available at all. */
  nonInteractiveHint?: string;
}

/**
 * Shows a single-topic menu (mode, permissions, thinking, commands, ...) with
 * a consistent look (title, ● / ○ markers, › cursor, shared footer) and
 * falls back to a plain ctx.ui.select() when the custom overlay UI throws
 * (e.g. non-interactive contexts or minimal test mocks).
 */
export async function runMenu<T>(
  ctx: ExtensionContext,
  title: string,
  entries: MenuEntry<T>[],
  opts: RunMenuOptions = {},
): Promise<T | undefined> {
  if (ctx.mode !== "tui" || !ctx.hasUI) {
    ctx.ui.notify(
      opts.nonInteractiveHint ?? `${title} benötigt den TUI-Modus.`,
      "error",
    );
    return undefined;
  }

  const selected = await selectMenuEntry(
    entries,
    () => selectWithCustomUi(ctx, title, entries),
    (labels) => ctx.ui.select(opts.fallbackPrompt ?? title, labels),
  );
  return selected?.value;
}
