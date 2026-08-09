import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

/**
 * Pure, terminal-cell-safe display form for the session cwd.
 *
 * The caller supplies both paths from session state, so this helper never
 * resolves paths or touches the filesystem. It favors a home-relative full
 * path first, then an ellipsized path that retains the final directory.
 */
export function compactCwd(
  cwd: string,
  maxColumns: number,
  homeDirectory?: string,
): string {
  const available = Math.max(1, Math.floor(maxColumns));
  const home = homeDirectory?.replace(/\/+$/, "");
  const normalized = cwd || "/";
  const withinHome = Boolean(
    home && (normalized === home || normalized.startsWith(`${home}/`)),
  );
  const display = withinHome
    ? normalized === home
      ? "~"
      : `~${normalized.slice(home!.length)}`
    : normalized;

  if (visibleWidth(display) <= available) return display;

  const parts = display.split("/").filter(Boolean);
  const leaf = parts.at(-1) ?? display;
  const rooted = display.startsWith("/");
  const prefix = display.startsWith("~") ? "~" : rooted ? "/" : "";
  const ellipsized = prefix
    ? `${prefix}/…/${leaf}`
    : `…/${leaf}`;
  if (visibleWidth(ellipsized) <= available) return ellipsized;

  const short = prefix ? `${prefix}/${leaf}` : leaf;
  if (visibleWidth(short) <= available) return short;
  return truncateToWidth(leaf, available, "…");
}
