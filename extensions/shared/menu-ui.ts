import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createInfoBoxComponent } from "./info-box.ts";
import { glyphsFor, resolveRenderProfile, truncatePlain } from "./render-profile.ts";

// `@earendil-works/pi-tui` is intentionally imported dynamically inside
// selectWithCustomUi() below, guarded by a `ctx.ui.custom` capability check,
// rather than as a static top-level import here. A static value-import from
// an npm package makes this file (and anything importing it, e.g.
// mode-permissions.ts / ux-status.ts) unloadable by the tests/run.mjs jiti
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
    throw new Error("Custom UI overlay not supported in this context.");
  }
  const { Key, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } =
    await import("@earendil-works/pi-tui");

  return ctx.ui.custom<MenuEntry<T> | undefined>(
    (tui, theme, _keybindings, done) => {
      let selectedIndex = initialMenuIndex(entries);

      const refresh = () => tui.requestRender();
      const profile = resolveRenderProfile({ mode: ctx.mode });
      const glyphs = glyphsFor(profile);
      const box = createInfoBoxComponent(
        {
          title,
          sections: [],
          tone: "accent",
          background: "customMessageBg",
          profile,
          tuiHelpers: { visibleWidth, truncateToWidth, wrapTextWithAnsi, matchesKey, Key },
        },
        theme,
      );

      const move = (delta: number) => {
        if (selectedIndex < 0) return;
        selectedIndex = moveMenuIndex(selectedIndex, delta, entries.length);
        refresh();
      };

      const buildMenuLines = (innerWidth: number): string[] => {
        const lines: string[] = [];
        let lastSection: string | undefined;

        for (let index = 0; index < entries.length; index += 1) {
          const entry = entries[index];
          if (entry.section !== undefined && entry.section !== lastSection) {
            lines.push(theme.fg("dim", theme.bold(entry.section.toUpperCase())));
            lastSection = entry.section;
          }

          const selected = index === selectedIndex;
          const marker = entry.current ? glyphs.selected : glyphs.unselected;
          const cursor = selected ? `${glyphs.cursor} ` : "  ";
          const statusText = entry.current ? "current" : "option";
          const textColor = selected ? "accent" : "text";
          const compact = profile.compact || innerWidth < 60;
          const titleText = `${cursor}${marker} ${entry.label} [${statusText}]`;

          if (compact) {
            const descWidth = Math.max(12, innerWidth - visibleWidth(titleText) - 3);
            const desc = truncateToWidth(entry.description, descWidth, glyphs.ellipsis);
            const separator = profile.unicode ? "—" : "-";
            lines.push(
              `${theme.fg(textColor, selected ? theme.bold(titleText) : titleText)} ${theme.fg("muted", separator)} ${theme.fg("muted", desc)}`,
            );
            continue;
          }

          lines.push(theme.fg(textColor, selected ? theme.bold(titleText) : titleText));
          const wrapped = wrapTextWithAnsi(theme.fg("muted", entry.description), innerWidth - 2);
          for (let i = 0; i < wrapped.length && i < 3; i++) {
            lines.push(`  ${wrapped[i]}`);
          }
          if (wrapped.length > 3) {
            lines.push(
              theme.fg("dim", `  ${truncatePlain(`${glyphs.ellipsis} ${wrapped.length - 3} weitere Zeile(n)`, innerWidth - 2, glyphs.ellipsis)}`),
            );
          }
        }

        return lines;
      };

      return {
        render(width: number): string[] {
          if (width < 30) {
            return [theme.fg("warning", "Terminal zu schmal — nutze Fallback-Menü.")];
          }
          // InfoBox uses width - 4 for inner content; descriptions are wrapped
          // to innerWidth - 2 because of the two-space indentation.
          const innerWidth = Math.max(1, width - 4);
          const menuLines = buildMenuLines(innerWidth - 2);
          box.setSections!([
            { lines: menuLines },
            {
              lines: [
                theme.fg(
                  "dim",
                  profile.unicode
                    ? "↑↓ wählen • Enter übernehmen • Esc schließen"
                    : "up/down waehlen | Enter uebernehmen | Esc schliessen",
                ),
              ],
            },
          ]);
          return box.render(width);
        },
        invalidate() {
          box.invalidate();
        },
        handleInput(data: string): void {
          if (matchesKey(data, Key.up)) {
            move(-1);
          } else if (matchesKey(data, Key.down)) {
            move(1);
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
      overlayOptions: {
        anchor: "center",
        width: "90%",
        maxHeight: "80%",
        margin: 2,
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
