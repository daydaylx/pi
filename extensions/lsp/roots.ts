/**
 * Workspace-root detection from a file path and configurable marker files.
 *
 * The algorithm walks **up** from the given `filePath`'s directory,
 * inspects each parent for the presence of any marker, and returns the first
 * match. Returns `undefined` when the filesystem root is reached without
 * a match.
 *
 * Issue #94 — configuration, root detection and registry.
 */

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { type LspLogger } from "./types.ts";

/**
 * Find the nearest ancestor directory that contains at least one of `markers`.
 *
 * @param filePath - An absolute path (typically the current open file).
 * @param markers  - File names to look for, e.g. `["package.json","tsconfig.json"]`.
 * @param maxHeight - Maximum parents to walk (safety limit, default 16).
 * @param logger   - Optional sink for diagnostic output.
 * @returns The absolute directory path, or `undefined` if nothing matches.
 */
export function findWorkspaceRoot(
  filePath: string,
  markers: string[],
  maxHeight: number = 16,
  logger?: LspLogger,
): string | undefined {
  const resolved = resolve(filePath);
  let current = dirname(resolved);

  for (let h = 0; h < maxHeight; h++) {
    for (const marker of markers) {
      const candidate = join(current, marker);
      if (existsSync(candidate)) {
        logger?.("info", `workspace root found at ${current} (marker: ${marker})`);
        return current;
      }
    }
    const parent = dirname(current);
    if (parent === current) break; // reached filesystem root
    current = parent;
  }

  logger?.("info", `no workspace root found for ${filePath} (markers: ${markers.join(", ")})`);
  return undefined;
}
