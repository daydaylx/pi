import { truncateToWidth } from "@earendil-works/pi-tui";

/**
 * Aurora's width-safe truncation, accounting for ANSI escapes and wide glyphs.
 *
 * The size classes this file used to define moved to `shared/layout.ts`, where
 * the menu shell reaches them too. Only the truncation stayed behind: it is the
 * one piece that needs `pi-tui` at module scope, and `shared/layout.ts` has to
 * remain import-free so the menu modules can use it under the jiti test loader.
 */
export function crop(value: string, width: number): string {
  return truncateToWidth(value, Math.max(1, width), "…");
}
