/**
 * The single jiti bootstrap for every regression suite.
 *
 * Source files live next to (not beneath) npm/node_modules, so value imports
 * are aliased explicitly: a clean install stays portable and does not rely on
 * a globally installed Pi runtime or a root-level node_modules symlink.
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "..", "..");
const require = createRequire(import.meta.url);
const { createJiti } = require("../../npm/node_modules/jiti");

// Pi's runtime-only packages can be nested below pi-coding-agent while
// normal dev dependencies are hoisted under npm/node_modules.
const PACKAGE_ROOTS = [
  path.join(ROOT, "npm", "node_modules"),
  path.join(
    ROOT,
    "npm",
    "node_modules",
    "@earendil-works",
    "pi-coding-agent",
    "node_modules",
  ),
];

// Resolve a package's real entry file by reading its package.json directly
// (exports["."] / module / main) instead of Node's require.resolve(): the
// latter walks up parent directories on a resolve miss and can hit the
// broken, empty /home/d/package.json outside this repo, crashing with
// ERR_INVALID_PACKAGE_CONFIG. This also correctly handles ESM-only packages
// (e.g. @earendil-works/pi-ai) whose "exports" field has no "require"
// condition, which require.resolve() cannot resolve at all.
export function npmModuleEntry(packageName) {
  for (const root of PACKAGE_ROOTS) {
    const pkgDir = path.join(root, ...packageName.split("/"));
    const pkgJsonPath = path.join(pkgDir, "package.json");
    if (!existsSync(pkgJsonPath)) continue;
    const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
    const dotExport =
      typeof pkg.exports === "string" ? pkg.exports : pkg.exports?.["."];
    const entry =
      (typeof dotExport === "string"
        ? dotExport
        : (dotExport?.import ?? dotExport?.default ?? dotExport?.node)) ??
      pkg.module ??
      pkg.main ??
      "index.js";
    return path.join(pkgDir, entry);
  }
  // The fallback keeps errors meaningful before a clean install.
  return path.join(ROOT, "npm", "node_modules", packageName);
}

const jiti = createJiti(path.join(ROOT, "npm", "package.json"), {
  alias: {
    "@earendil-works/pi-coding-agent": npmModuleEntry(
      "@earendil-works/pi-coding-agent",
    ),
    "@earendil-works/pi-agent-core": npmModuleEntry(
      "@earendil-works/pi-agent-core",
    ),
    "@earendil-works/pi-ai": npmModuleEntry("@earendil-works/pi-ai"),
    "@earendil-works/pi-tui": npmModuleEntry("@earendil-works/pi-tui"),
    typebox: npmModuleEntry("typebox"),
  },
});

/** Import a repo-relative TypeScript module. Throws on failure. */
export const importModule = (relativePath) =>
  jiti.import(path.join(ROOT, relativePath));
