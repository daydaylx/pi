import { isAbsolute, relative, resolve, sep } from "node:path";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

/**
 * Pure, workspace-relative display form for a tool-reported path. Never
 * touches the filesystem — only string math against the two paths the caller
 * already has.
 */
export function toWorkspaceRelative(cwd: string, path: string): string {
  const target = isAbsolute(path) ? path : resolve(cwd, path);
  const relativePath = relative(cwd, target);
  if (
    relativePath &&
    relativePath !== ".." &&
    !relativePath.startsWith(`..${sep}`)
  ) {
    return relativePath;
  }
  return path;
}

/**
 * Ellipsizes an already-formatted path/display string when it overflows
 * `maxColumns`, preferring to keep the final segment (the part a reader scans
 * for first) over the leading directories. Falls back to a hard end-truncate
 * only once even the bare leaf no longer fits.
 */
export function ellipsizeMiddle(display: string, maxColumns: number): string {
  const available = Math.max(1, Math.floor(maxColumns));
  if (visibleWidth(display) <= available) return display;

  const parts = display.split("/").filter(Boolean);
  const leaf = parts.at(-1) ?? display;
  const rooted = display.startsWith("/");
  const prefix = display.startsWith("~") ? "~" : rooted ? "/" : "";
  const ellipsized = prefix ? `${prefix}/…/${leaf}` : `…/${leaf}`;
  if (visibleWidth(ellipsized) <= available) return ellipsized;

  const short = prefix ? `${prefix}/${leaf}` : leaf;
  if (visibleWidth(short) <= available) return short;
  return truncateToWidth(leaf, available, "…");
}
