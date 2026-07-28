/**
 * Technical scope matching for the completion pipeline.
 *
 * The scope lives in the PlanSnapshot ("Technischer Scope") and is the only
 * machine-enforceable part of the plan. This module answers one question:
 * which changed files fall outside it. It reads no files and holds no state.
 */

function normalizePath(value: string): string {
  let normalized = value.trim().replace(/\\/g, "/");
  while (normalized.startsWith("./")) normalized = normalized.slice(2);
  return normalized;
}

export interface ScopeMatchResult {
  /** Changed files that match a declared scope pattern. */
  inScope: string[];
  /** Changed files that match NO declared scope pattern (drift). */
  outOfScope: string[];
  /** Declared scope patterns that no changed file matched (possibly incomplete). */
  undeclared: string[];
}

/**
 * Convert a minimal glob into a RegExp. Supports:
 *   **  -> any characters including '/'  (across segments)
 *   *   -> any characters except '/'     (within one segment)
 *   ?   -> one character except '/'
 * Everything else is escaped literally.
 */
export function globToRegExp(pattern: string): RegExp {
  const src = normalizePath(pattern);
  const endsWithSlash = src.endsWith("/");
  let out = "^";
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === "*") {
      if (src[i + 1] === "*") {
        out += ".*";
        i++; // consume second '*'
        // tolerate an optional following slash so "src/**" matches "src/x/y"
        if (src[i + 1] === "/") i++;
      } else {
        out += "[^/]*";
      }
    } else if (ch === "?") {
      out += "[^/]";
    } else if (/[.+^${}()|[\]\\]/.test(ch)) {
      out += "\\" + ch;
    } else {
      out += ch;
    }
  }
  // A bare directory prefix like "docs/" should match files beneath it.
  if (endsWithSlash) out += ".+";
  out += "$";
  return new RegExp(out);
}

/**
 * Match changed files against a declared scope. A file is "in scope" if it
 * matches any pattern; a pattern is "undeclared" if no changed file matched it.
 *
 * An empty scope means "no usable scope was declared" — NOT "everything is out
 * of scope". Callers must surface that case themselves; completion.ts reports
 * it as a required check that could not run.
 */
export function matchScope(
  expectedScope: string[],
  changedFiles: string[],
): ScopeMatchResult {
  const patterns = expectedScope.map(normalizePath).filter(Boolean);
  const files = changedFiles.map(normalizePath).filter(Boolean);
  if (patterns.length === 0)
    return { inScope: [], outOfScope: [], undeclared: [] };
  const regexes = patterns.map((pattern) => globToRegExp(pattern));
  const matched = new Set<string>();
  const usedPatterns = new Set<number>();
  for (const file of files) {
    for (let i = 0; i < regexes.length; i++) {
      if (regexes[i].test(file)) {
        matched.add(file);
        usedPatterns.add(i);
      }
    }
  }
  return {
    inScope: files.filter((file) => matched.has(file)),
    outOfScope: files.filter((file) => !matched.has(file)),
    undeclared: patterns.filter((_, i) => !usedPatterns.has(i)),
  };
}
