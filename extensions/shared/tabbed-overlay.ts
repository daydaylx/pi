import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  calculateMenuViewport,
  initialMenuIndex,
  menuOverlayWidth,
  moveMenuIndex,
  type MenuEntry,
} from "./menu-ui.ts";

/** One independently selectable page in a keyboard-only overlay. */
export interface TabbedOverlayTab<T> {
  id: string;
  label: string;
  /** A short, non-interactive status marker displayed next to the tab title. */
  badge?: string;
  entries: readonly MenuEntry<T>[];
}

export interface TabbedOverlaySelection<T> {
  tabId: string;
  entry: MenuEntry<T>;
}

export interface RunTabbedOverlayOptions {
  initialTabId?: string;
  nonInteractiveHint?: string;
}

interface TabState<T> {
  tab: TabbedOverlayTab<T>;
  selected: number;
  viewportStart: number;
}

const ELLIPSIS = "…";

/**
 * Shows a reusable, modal tab dialog. Tab/Shift+Tab select pages; arrows and
 * page keys select entries within the active page. It intentionally has no
 * nested menus: callers decide what an Enter selection means.
 */
export async function runTabbedOverlay<T>(
  ctx: ExtensionContext,
  title: string,
  tabs: readonly TabbedOverlayTab<T>[],
  options: RunTabbedOverlayOptions = {},
): Promise<TabbedOverlaySelection<T> | undefined> {
  if (ctx.mode !== "tui" || !ctx.hasUI) {
    ctx.ui.notify(options.nonInteractiveHint ?? `${title} benötigt den TUI-Modus.`, "error");
    return undefined;
  }
  if (tabs.length === 0) return undefined;
  if (typeof ctx.ui.custom !== "function") {
    ctx.ui.notify(`${title} benötigt ein benutzerdefiniertes TUI-Overlay.`, "error");
    return undefined;
  }

  // Keep this dynamic: static pi-tui imports break the jiti test loader.
  const { Key, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } = await import("@earendil-works/pi-tui");
  let terminal = () => ({ columns: process.stdout.columns ?? 80, rows: process.stdout.rows ?? 24 });
  const start = Math.max(0, tabs.findIndex((tab) => tab.id === options.initialTabId));

  try {
    return await ctx.ui.custom<TabbedOverlaySelection<T> | undefined>((tui, theme, _keybindings, done) => {
    const states: TabState<T>[] = tabs.map((tab) => ({ tab, selected: initialMenuIndex(tab.entries), viewportStart: 0 }));
    let active = start;
    let visibleEntries = 1;
    terminal = () => ({ columns: tui.terminal.columns, rows: tui.terminal.rows });
    const current = () => states[active]!;
    const pad = (value: string, width: number) => truncateToWidth(value, Math.max(1, width), ELLIPSIS, true);
    const fg = (color: string, value: string) => theme.fg(color as never, value);
    const border = (value: string) => fg("border", value);
    const tone = (entry: MenuEntry<T>) => entry.disabled ? "dim" : entry.tone === "danger" ? "error" : entry.tone === "warning" ? "warning" : entry.tone === "success" ? "success" : entry.tone === "muted" ? "muted" : "text";
    const tag = (entry: MenuEntry<T>) => entry.badge ?? (entry.disabled ? "NICHT VERFÜGBAR" : entry.current ? "AKTIV" : undefined);
    const cycleTab = (delta: number) => { active = (active + delta + states.length) % states.length; };
    const isTab = (data: string) => data === "\t" || (Key as { tab?: string }).tab === data;
    const isShiftTab = (data: string) => data === "\u001b[Z" || data === "\u001b\t" || (Key as { shift?: (key: string) => string }).shift?.((Key as { tab?: string }).tab ?? "\t") === data;

    return {
      render(width: number): string[] {
        const size = terminal();
        const inner = Math.max(1, width - 2);
        const state = current();
        state.selected = state.selected >= 0 && !state.tab.entries[state.selected]?.disabled ? state.selected : initialMenuIndex(state.tab.entries);
        const tabLine = states.map((item, index) => {
          const marker = index === active ? "●" : "○";
          const badge = item.tab.badge ? ` [${item.tab.badge}]` : "";
          return `${marker} ${item.tab.label}${badge}`;
        }).join("  ");
        const entryLines = state.tab.entries.map((entry, index) => {
          const label = `${index === state.selected ? "▌" : " "} ${entry.icon ? `${entry.icon} ` : ""}${entry.label}${tag(entry) ? ` [${tag(entry)}]` : ""}`;
          const lines = [fg(tone(entry), pad(label, inner))];
          if ((entry.disabled ? entry.disabledReason ?? entry.description : entry.description) && size.rows >= 18) {
            const description = entry.disabled ? entry.disabledReason ?? entry.description! : entry.description!;
            lines.push(...wrapTextWithAnsi(fg(entry.disabled ? "dim" : "muted", `   ${description}`), Math.max(1, inner)).slice(0, 1).map((line: string) => pad(line, inner)));
          }
          return lines;
        });
        const fixed = 7;
        const view = calculateMenuViewport(entryLines.map((lines) => lines.length), state.selected, state.viewportStart, Math.max(1, size.rows - fixed - 4));
        state.viewportStart = view.start;
        visibleEntries = Math.max(1, view.end - view.start);
        const content: string[] = [];
        if (view.showAbove) content.push(fg("dim", ` ↑ ${view.start} weitere Einträge`));
        for (let index = view.start; index < view.end; index += 1) content.push(...entryLines[index]!);
        if (view.showBelow) content.push(fg("dim", ` ↓ ${state.tab.entries.length - view.end} weitere Einträge`));
        if (content.length === 0) content.push(fg("muted", " Keine Einträge verfügbar."));
        const selected = state.selected >= 0 ? state.tab.entries[state.selected] : undefined;
        const footer = `Tab Tabs · ↑↓ Auswahl · Enter ${selected?.disabled ? "nicht verfügbar" : "übernehmen"} · Esc schließen`;
        const frame = (value: string) => `${border("│")}${pad(value, inner)}${border("│")}`;
        if (width < 4) return [truncateToWidth(title, width, ELLIPSIS)];
        return [
          `${border("╭")}${border("─".repeat(inner))}${border("╮")}`,
          frame(fg("accent", theme.bold(` ${title}`))),
          frame(fg("muted", tabLine)),
          `${border("├")}${border("─".repeat(inner))}${border("┤")}`,
          ...content.map(frame),
          `${border("├")}${border("─".repeat(inner))}${border("┤")}`,
          frame(fg("dim", footer)),
          `${border("╰")}${border("─".repeat(inner))}${border("╯")}`,
        ];
      },
      invalidate() {},
      handleInput(data: string): void {
        const state = current();
        if (isTab(data)) cycleTab(1);
        else if (isShiftTab(data)) cycleTab(-1);
        else if (matchesKey(data, Key.left)) cycleTab(-1);
        else if (matchesKey(data, Key.right)) cycleTab(1);
        else if (matchesKey(data, Key.up)) state.selected = moveMenuIndex(state.selected, -1, state.tab.entries);
        else if (matchesKey(data, Key.down)) state.selected = moveMenuIndex(state.selected, 1, state.tab.entries);
        else if (matchesKey(data, Key.pageUp)) { state.selected = Math.max(0, state.selected - visibleEntries); state.viewportStart = state.selected; }
        else if (matchesKey(data, Key.pageDown)) state.selected = Math.min(state.tab.entries.length - 1, state.selected + visibleEntries);
        else if (matchesKey(data, Key.home)) { state.selected = initialMenuIndex(state.tab.entries); state.viewportStart = 0; }
        else if (matchesKey(data, Key.end)) { state.selected = [...state.tab.entries].map((entry, index) => ({ entry, index })).reverse().find((item) => !item.entry.disabled)?.index ?? -1; state.viewportStart = Math.max(0, state.selected); }
        else if (matchesKey(data, Key.enter)) {
          const entry = state.selected >= 0 ? state.tab.entries[state.selected] : undefined;
          if (entry && !entry.disabled) done({ tabId: state.tab.id, entry });
          return;
        } else if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) { done(undefined); return; }
        else return;
        tui.requestRender();
      },
    };
    }, {
    overlay: true,
    overlayOptions: () => {
      const size = terminal();
      const margin = size.columns < 36 || size.rows < 14 ? 1 : 2;
      const entries = tabs.flatMap((tab) => tab.entries);
      const width = menuOverlayWidth(size.columns, title, entries);
      return { anchor: "center", width, minWidth: Math.min(30, width), maxHeight: Math.max(1, size.rows - margin * 2), margin };
    },
    });
  } catch {
    // Keep commands usable in stripped-down/embedded TUIs. The full TUI gets
    // tabs; the deterministic fallback preserves every selectable action.
    const raw = tabs.flatMap((tab) => tab.entries
      .filter((entry) => !entry.disabled)
      .map((entry) => ({ tabId: tab.id, entry, path: `${tab.label} › ${entry.label}` })));
    const occurrences = new Map<string, number>();
    for (const item of raw) occurrences.set(item.entry.label, (occurrences.get(item.entry.label) ?? 0) + 1);
    const flattened = raw.map((item) => ({
      ...item,
      label: occurrences.get(item.entry.label) === 1 ? item.entry.label : item.path,
    }));
    const choice = await ctx.ui.select(title, flattened.map((item) => item.label));
    const selected = flattened.find((item) => item.label === choice);
    return selected ? { tabId: selected.tabId, entry: selected.entry } : undefined;
  }
}
