/**
 * Path patterns that turn AGENTS.md's prose-only verifier-mandatory
 * categories into a mechanically checkable signal.
 *
 * Not every category in AGENTS.md's "Der `verifier` ist verpflichtend, wenn…"
 * list can be decided from a diff: "hoher Blast-Radius" is a judgment about
 * scope/impact, and "eine ausdrückliche Nutzeranforderung" is a human signal,
 * not a path. Both stay the main agent's call, same as before. This module
 * covers only the categories a changed-file list can actually answer:
 * permission/workflow/plan-mode logic, the verifier/completion machinery
 * itself, the Electron preload/IPC trust boundary, and install/upgrade entry
 * points — exactly the class of change that shipped unverified during the
 * 2026-08-28..31 Electron GUI batch.
 */

interface RequiredPathRule {
  category: string;
  test: (relativePath: string) => boolean;
}

function underDir(dir: string): (path: string) => boolean {
  return (path) => path === dir || path.startsWith(`${dir}/`);
}

function oneOf(...paths: string[]): (path: string) => boolean {
  const set = new Set(paths);
  return (path) => set.has(path);
}

const RULES: RequiredPathRule[] = [
  {
    category: "Permission-, Workflow- oder Plan-Mode-Logik",
    test: (path) =>
      underDir("extensions/permissions")(path) ||
      underDir("extensions/plan-mode")(path) ||
      underDir("extensions/resilience")(path) ||
      path === "extensions/shared/permission-policy.ts" ||
      (path.startsWith("extensions/shared/workflow-") &&
        path.endsWith(".ts")) ||
      // Every capability bridge (workflow-/recovery-/verification-capabilities.ts,
      // and any future sibling) carries cross-extension permission state —
      // matched by suffix instead of by name so a new bridge is covered
      // without a second edit here.
      (path.startsWith("extensions/shared/") &&
        path.endsWith("-capabilities.ts")),
  },
  {
    category: "Verifikations- oder Completion-Logik",
    test: oneOf(
      "extensions/setup-core/index.ts",
      "extensions/setup-core/verification-status.ts",
      "extensions/setup-core/subagent-output-guard.ts",
      ".pi/verify.json",
    ),
  },
  {
    category: "Sicherheitsverhalten (Electron-Trust-Grenze)",
    test: (path) =>
      path === "gui/main/preload.cjs" ||
      path === "gui/main/pi-rpc-manager.js" ||
      (path.startsWith("gui/main/") && path.includes("ipc")),
  },
  {
    category: "Installations- oder Upgrade-Verhalten",
    test: oneOf("bin/pi", "bin/pi-gui", "package.json", "gui/package.json"),
  },
];

/** The first matching category for one path, if any. */
export function matchesVerifierRequiredPath(
  relativePath: string,
): string | undefined {
  return RULES.find((rule) => rule.test(relativePath))?.category;
}

export interface VerifierRequiredPathHit {
  path: string;
  category: string;
}

/** All changed paths that hit a mandatory category, each with its category. */
export function matchingVerifierRequiredPaths(
  relativePaths: readonly string[],
): VerifierRequiredPathHit[] {
  const hits: VerifierRequiredPathHit[] = [];
  for (const path of relativePaths) {
    const category = matchesVerifierRequiredPath(path);
    if (category) hits.push({ path, category });
  }
  return hits;
}
