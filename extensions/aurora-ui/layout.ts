import { truncateToWidth } from "@earendil-works/pi-tui";

/**
 * Aurora's width-safe truncation, accounting for ANSI escapes and wide glyphs.
 *
 * The size classes this file used to define moved to `shared/layout.ts`, where
 * the menu shell reaches them too. Only the truncation stayed behind: it is the
 * one piece that needs `pi-tui` at module scope, and `shared/layout.ts` has to
 * remain import-free so the menu modules can use it under the jiti test loader.
 *
 * `truncateToWidth` wraps its injected ellipsis in full resets
 * (`\x1b[0m…\x1b[0m`) and may preserve the original closing codes after it.
 * That punches an unfilled hole into a tile row and can leave the preceding
 * `\x1b[38;...m` or `\x1b[1m` unclosed; the unclosed codes then bleed into the
 * next segment, frame, or neighbouring tile. This wrapper removes the reset
 * artifacts, keeps any suffix that still fits, and re-balances the visible
 * prefix by appending only the closes that are actually missing
 * (`\x1b[39m` for foreground, `\x1b[22m` for bold).
 */
export function crop(value: string, width: number): string {
  const clipped = truncateToWidth(value, Math.max(1, width), "…");
  // If nothing was truncated, leave the caller's string exactly as is.
  if (clipped === value) return clipped;
  const ellipsisIndex = clipped.lastIndexOf("…");
  if (ellipsisIndex < 0) return clipped;
  // Strip the reset that truncateToWidth placed immediately before the
  // ellipsis and any codes it preserved/added after the ellipsis. The suffix
  // (e.g. a status/runtime marker) starts at the first non-ANSI char after
  // the trailing reset run.
  const beforeReset = clipped
    .slice(0, ellipsisIndex)
    .replace(/(?:\x1b\[[0-9;]*[A-Za-z])+$/, "");
  const afterEllipsis = clipped
    .slice(ellipsisIndex + 1)
    .replace(/^(?:\x1b\[[0-9;]*[A-Za-z])+/, "");
  const prefix = `${beforeReset}…`;
  const fgOpens = (prefix.match(/\x1b\[38;2;[0-9;]*m/g) ?? []).length;
  const fgCloses = (prefix.match(/\x1b\[39m/g) ?? []).length;
  const boldOpens = (prefix.match(/\x1b\[1m/g) ?? []).length;
  const boldCloses = (prefix.match(/\x1b\[22m/g) ?? []).length;
  const closes: string[] = [];
  if (boldOpens > boldCloses) closes.push("\x1b[22m");
  if (fgOpens > fgCloses) closes.push("\x1b[39m");
  return `${prefix}${closes.join("")}${afterEllipsis}`;
}
