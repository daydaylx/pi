import { relative, sep } from "node:path";

/** True if `target` (already resolved) is `base` itself or lies below it. */
export function isInside(base: string, target: string): boolean {
  const rel = relative(base, target);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`));
}
