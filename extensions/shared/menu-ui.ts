import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/** Pure menu data; menu builders never need to know about TUI rendering. */
export interface MenuEntry<T> {
  id: string;
  label: string;
  description?: string;
  details?: string;
  section?: string;
  icon?: string;
  badge?: string;
  tone?: "default" | "success" | "warning" | "danger" | "muted";
  current?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  dangerous?: boolean;
  shortcut?: string;
  value?: T;
  children?: readonly MenuEntry<T>[];
}

export function initialMenuIndex<T>(entries: readonly MenuEntry<T>[]): number {
  const current = entries.findIndex((entry) => entry.current && !entry.disabled);
  return current >= 0 ? current : entries.findIndex((entry) => !entry.disabled);
}

export function moveMenuIndex<T>(current: number, delta: number, entries: readonly MenuEntry<T>[]): number;
export function moveMenuIndex(current: number, delta: number, count: number): number;
export function moveMenuIndex<T>(
  current: number,
  delta: number,
  entriesOrCount: readonly MenuEntry<T>[] | number,
): number {
  if (typeof entriesOrCount === "number") {
    return current < 0 || entriesOrCount === 0 ? -1 : ((current + delta) % entriesOrCount + entriesOrCount) % entriesOrCount;
  }
  const entries = entriesOrCount;
  if (!entries.some((entry) => !entry.disabled)) return -1;
  let index = current >= 0 && current < entries.length && !entries[current]?.disabled
    ? current
    : initialMenuIndex(entries);
  const step = delta < 0 ? -1 : 1;
  for (let tries = 0; tries < entries.length; tries += 1) {
    index = (index + step + entries.length) % entries.length;
    if (!entries[index]?.disabled) return index;
  }
  return -1;
}

export interface MenuViewport {
  start: number;
  end: number;
  showAbove: boolean;
  showBelow: boolean;
  contentLineBudget: number;
}

export function calculateMenuViewport(
  lineCounts: readonly number[],
  selectedIndex: number,
  preferredStart: number,
  maxLines: number,
): MenuViewport {
  if (lineCounts.length === 0 || selectedIndex < 0) {
    return { start: 0, end: 0, showAbove: false, showBelow: false, contentLineBudget: Math.max(0, maxLines) };
  }
  const budget = Math.max(1, Math.floor(maxLines));
  const selected = Math.max(0, Math.min(lineCounts.length - 1, selectedIndex));
  let start = Math.max(0, Math.min(selected, Math.floor(preferredStart)));
  const fit = (from: number): MenuViewport => {
    const showAbove = from > 0 && budget >= 2;
    const usable = budget - (showAbove ? 1 : 0);
    let end = from;
    let used = 0;
    while (end < lineCounts.length) {
      const lines = Math.max(1, lineCounts[end] ?? 1);
      const reserve = end < lineCounts.length - 1 && usable >= 2 ? 1 : 0;
      if (used + lines + reserve <= usable) { used += lines; end += 1; }
      else { if (end === from) end += 1; break; }
    }
    const showBelow = end < lineCounts.length && usable >= 2;
    return { start: from, end, showAbove, showBelow, contentLineBudget: Math.max(1, budget - (showAbove ? 1 : 0) - (showBelow ? 1 : 0)) };
  };
  let result = fit(start);
  while (selected >= result.end && start < selected) result = fit(++start);
  return result;
}

type Layout = "compact" | "standard" | "comfortable";
const ELLIPSIS = "…";

function layoutFor(columns: number, rows: number): Layout {
  if (columns < 52 || rows < 14) return "compact";
  return columns >= 90 && rows >= 28 ? "comfortable" : "standard";
}

function marginFor(columns: number, rows: number): number {
  return columns < 36 || rows < 14 ? 1 : 2;
}

/** Content-independent width avoids all ANSI and wide-character mismeasurement. */
export function menuOverlayWidth<T>(terminalWidth: number, _title: string, _entries: readonly MenuEntry<T>[]): number {
  const columns = Math.max(1, Math.floor(terminalWidth));
  const available = Math.max(1, columns - (columns < 36 ? 2 : 4));
  return Math.max(1, Math.min(available, Math.max(Math.min(48, available), Math.min(96, Math.floor(columns * 0.8)))));
}

function flatten<T>(entries: readonly MenuEntry<T>[], path: readonly string[] = []): Array<{ entry: MenuEntry<T>; label: string }> {
  const result: Array<{ entry: MenuEntry<T>; label: string }> = [];
  for (const entry of entries) {
    if (entry.disabled) continue;
    if (entry.children) result.push(...flatten(entry.children, [...path, entry.label]));
    else result.push({ entry, label: [...path, entry.label].join(" › ") });
  }
  return result;
}

export async function selectMenuEntry<T>(
  entries: readonly MenuEntry<T>[],
  customPicker: () => Promise<MenuEntry<T> | undefined>,
  fallbackPicker: (labels: string[]) => Promise<string | undefined>,
): Promise<MenuEntry<T> | undefined> {
  try { return await customPicker(); }
  catch {
    const flat = flatten(entries);
    const duplicates = new Map<string, number>();
    for (const item of flat) duplicates.set(item.entry.label, (duplicates.get(item.entry.label) ?? 0) + 1);
    const labels = flat.map((item) => duplicates.get(item.entry.label) === 1 ? item.entry.label : item.label);
    const choice = await fallbackPicker(labels);
    return flat[labels.indexOf(choice ?? "")]?.entry;
  }
}

interface Level<T> {
  entries: readonly MenuEntry<T>[];
  selected: number;
  viewportStart: number;
  label: string;
}

async function selectWithCustomUi<T>(
  ctx: ExtensionContext,
  title: string,
  entries: readonly MenuEntry<T>[],
): Promise<MenuEntry<T> | undefined> {
  if (typeof ctx.ui.custom !== "function") throw new Error("Benutzerdefiniertes TUI-Overlay wird nicht unterstützt.");
  // This must stay dynamic: static pi-tui imports break the jiti test loader.
  const { Key, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } = await import("@earendil-works/pi-tui");
  let terminal = () => ({ columns: process.stdout.columns ?? 80, rows: process.stdout.rows ?? 24 });
  return ctx.ui.custom<MenuEntry<T> | undefined>(
    (tui, theme, _keybindings, done) => {
      const stack: Level<T>[] = [{ entries, selected: initialMenuIndex(entries), viewportStart: 0, label: title }];
      let visibleEntries = 1;
      terminal = () => ({ columns: tui.terminal.columns, rows: tui.terminal.rows });
      const level = () => stack[stack.length - 1]!;
      const refresh = () => tui.requestRender();
      const pad = (value: string, width: number) => truncateToWidth(value, Math.max(1, width), ELLIPSIS, true);
      const fg = (color: string, value: string) => theme.fg(color as never, value);
      const border = (value: string) => fg("border", value);
      const frame = (value: string, inner: number) => `${border("│")}${pad(value, inner)}${border("│")}`;
      const divider = (inner: number) => `${border("├")}${border("─".repeat(Math.max(1, inner)))}${border("┤")}`;
      const tone = (entry: MenuEntry<T>) => entry.disabled ? "dim" : entry.tone === "danger" ? "error" : entry.tone === "warning" ? "warning" : entry.tone === "success" ? "success" : entry.tone === "muted" ? "muted" : "text";
      const tag = (entry: MenuEntry<T>) => entry.badge ?? (entry.disabled ? "NICHT VERFÜGBAR" : entry.dangerous ? "RISIKO" : entry.current ? "AKTIV" : undefined);
      const selectedRow = (value: string, width: number) => {
        const row = pad(value, width);
        const themed = theme as unknown as { bg?: (color: "selectedBg", text: string) => string; inverse?: (text: string) => string };
        return themed.bg ? themed.bg("selectedBg", row) : themed.inverse ? themed.inverse(row) : fg("accent", theme.bold(row));
      };
      const blocks = (inner: number, layout: Layout) => level().entries.map((entry, index) => {
        const lines: string[] = [];
        if (layout !== "compact" && entry.section && (index === 0 || entry.section !== level().entries[index - 1]?.section)) lines.push(fg("muted", theme.bold(pad(` ${entry.section.toLocaleUpperCase("de-DE")}`, inner))));
        const selectionLine = lines.length;
        const suffix = `${tag(entry) ? ` [${tag(entry)}]` : ""}${entry.children ? " ›" : ""}`;
        const main = `${index === level().selected ? "▌" : " "} ${entry.icon ? `${entry.icon} ` : ""}${entry.label}${suffix}`;
        const rendered = fg(tone(entry), pad(main, inner));
        lines.push(index === level().selected ? selectedRow(rendered, inner) : rendered);
        const description = entry.disabled ? entry.disabledReason ?? entry.description : entry.description;
        if (description && layout !== "compact") {
          for (const part of wrapTextWithAnsi(fg(entry.disabled ? "dim" : "muted", description), Math.max(1, inner - 3)).slice(0, layout === "comfortable" ? 2 : 1)) lines.push(pad(`   ${part}`, inner));
        }
        return { lines, selectionLine };
      });
      return {
        render(width: number): string[] {
          const size = terminal();
          const layout = layoutFor(width, size.rows);
          const current = level();
          current.selected = current.selected >= 0 && current.selected < current.entries.length && !current.entries[current.selected]?.disabled
            ? current.selected : initialMenuIndex(current.entries);
          const inner = Math.max(1, width - 2);
          const selected = current.selected >= 0 ? current.entries[current.selected] : undefined;
          const crumbs = stack.map((item) => item.label).join(" › ");
          const detail = layout === "comfortable" && selected
            ? wrapTextWithAnsi(fg(selected.dangerous ? "warning" : selected.disabled ? "dim" : "muted", selected.disabled ? selected.disabledReason ?? selected.details ?? selected.description ?? "" : selected.details ?? selected.description ?? ""), Math.max(1, inner - 2)).slice(0, 4).map((item) => pad(` ${item}`, inner))
            : [];
          const footerText = [
            "↑↓ Auswahl",
            selected?.children ? "Enter öffnen" : "Enter übernehmen",
            stack.length > 1 ? "←/Rücktaste zurück" : "",
            "Esc schließen",
          ].filter(Boolean).join(layout === "compact" ? " · " : "  ·  ");
          const footer = wrapTextWithAnsi(fg("dim", footerText), Math.max(1, inner)).slice(0, layout === "compact" ? 1 : 2).map((item) => pad(item, inner));
          const fixed = 2 + 1 + (layout === "compact" ? 0 : 1) + 2 + footer.length + (detail.length ? detail.length + 1 : 0);
          const budget = Math.max(1, size.rows - marginFor(size.columns, size.rows) * 2 - fixed);
          const renderedBlocks = blocks(inner, layout);
          const view = calculateMenuViewport(renderedBlocks.map((block) => block.lines.length), current.selected, current.viewportStart, budget);
          current.viewportStart = view.start;
          visibleEntries = Math.max(1, view.end - view.start);
          const content: string[] = [];
          if (view.showAbove) content.push(fg("dim", ` ↑ ${view.start} weitere Einträge`));
          let remaining = view.contentLineBudget;
          for (let index = view.start; index < view.end && remaining > 0; index += 1) {
            const block = renderedBlocks[index]!;
            const fitted = block.lines.length <= remaining ? block.lines : remaining === 1 ? [block.lines[block.selectionLine]!] : [block.lines[block.selectionLine]!, ...block.lines.slice(block.selectionLine + 1, block.selectionLine + remaining)];
            content.push(...fitted);
            remaining -= fitted.length;
          }
          if (view.showBelow) content.push(fg("dim", ` ↓ ${current.entries.length - view.end} weitere Einträge`));
          if (content.length === 0) content.push(fg("muted", " Keine Einträge verfügbar."));
          if (width < 4) return [truncateToWidth("Menü", width, ELLIPSIS)];
          return [
            `${border("╭")}${border("─".repeat(inner))}${border("╮")}`,
            frame(fg("accent", theme.bold(pad(` ${title}`, inner))), inner),
            ...(layout === "compact" ? [] : [frame(fg("muted", pad(` ${crumbs}`, inner)), inner)]),
            divider(inner),
            ...content.map((item) => frame(item, inner)),
            ...(detail.length ? [divider(inner), frame(fg("muted", theme.bold(pad(" DETAILS", inner))), inner), ...detail.map((item) => frame(item, inner))] : []),
            divider(inner),
            ...footer.map((item) => frame(item, inner)),
            `${border("╰")}${border("─".repeat(inner))}${border("╯")}`,
          ];
        },
        invalidate() {},
        handleInput(data: string): void {
          const current = level();
          if (matchesKey(data, Key.up)) current.selected = moveMenuIndex(current.selected, -1, current.entries);
          else if (matchesKey(data, Key.down)) current.selected = moveMenuIndex(current.selected, 1, current.entries);
          else if (matchesKey(data, Key.pageUp)) { current.selected = Math.max(0, current.selected - visibleEntries); current.viewportStart = current.selected; }
          else if (matchesKey(data, Key.pageDown)) current.selected = Math.min(current.entries.length - 1, current.selected + visibleEntries);
          else if (matchesKey(data, Key.home)) { current.selected = initialMenuIndex(current.entries); current.viewportStart = 0; }
          else if (matchesKey(data, Key.end)) { current.selected = [...current.entries].map((entry, index) => ({ entry, index })).reverse().find((item) => !item.entry.disabled)?.index ?? -1; current.viewportStart = Math.max(0, current.selected); }
          else if (matchesKey(data, Key.left) || matchesKey(data, Key.backspace)) { if (stack.length > 1) stack.pop(); else return; }
          else if (matchesKey(data, Key.enter)) {
            const entry = current.selected >= 0 ? current.entries[current.selected] : undefined;
            if (!entry || entry.disabled) return;
            if (entry.children) stack.push({ entries: entry.children, selected: initialMenuIndex(entry.children), viewportStart: 0, label: entry.label });
            else done(entry);
          } else if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) { done(undefined); return; }
          else return;
          refresh();
        },
      };
    },
    {
      overlay: true,
      overlayOptions: () => {
        const size = terminal();
        const margin = marginFor(size.columns, size.rows);
        const width = menuOverlayWidth(size.columns, title, entries);
        return { anchor: "center", width, minWidth: Math.min(30, width), maxHeight: Math.max(1, size.rows - margin * 2), margin };
      },
    },
  );
}

export interface RunMenuOptions {
  fallbackPrompt?: string;
  nonInteractiveHint?: string;
}

export async function runMenu<T>(
  ctx: ExtensionContext,
  title: string,
  entries: readonly MenuEntry<T>[],
  options: RunMenuOptions = {},
): Promise<T | undefined> {
  if (ctx.mode !== "tui" || !ctx.hasUI) {
    ctx.ui.notify(options.nonInteractiveHint ?? `${title} benötigt den TUI-Modus.`, "error");
    return undefined;
  }
  const selected = await selectMenuEntry(
    entries,
    () => selectWithCustomUi(ctx, title, entries),
    (labels) => ctx.ui.select(options.fallbackPrompt ?? title, labels),
  );
  return selected?.value;
}
