import { ellipsizeMiddle } from "../shared/paths.ts";

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

  return ellipsizeMiddle(display, maxColumns);
}
