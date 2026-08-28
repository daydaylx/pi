/**
 * Format-Gate für die GUI-Quellen: vergleicht jede Datei mit dem
 * Prettier-Ergebnis (gleiche Konfiguration wie npm run verify).
 *
 *   node gui/test/format-check.mjs           -> prüfen, Exit 1 bei Drift
 *   node gui/test/format-check.mjs --write   -> driftende Dateien fixen
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const guiDir = path.resolve(here, "..");
const repo = path.resolve(guiDir, "..");

// Bewusst ohne Abhängigkeit zu npm/node_modules: Prettier wird über die
// Repo-Installation geladen (gleiche Version wie format:check).
const prettierModule = await import(
  pathToFileUrl(path.join(repo, "npm", "node_modules", "prettier", "index.mjs"))
).catch(() => import("prettier"));
const prettier = prettierModule.default ?? prettierModule;

function pathToFileUrl(p) {
  return "file://" + p.replace(/\\/g, "/");
}

const configText = readFileSync(
  path.join(repo, ".prettierrc.json"),
  "utf8",
);
const config = JSON.parse(configText);

const files = [
  "main/index.js",
  "main/ipc-handlers.js",
  "main/pi-rpc-manager.js",
  "main/preload.cjs",
  "renderer/index.html",
  "renderer/renderer.js",
  "renderer/activity-summary.js",
  "renderer/interaction-helpers.js",
  "renderer/chat/markdown.js",
  "renderer/chat/code-block.js",
  "renderer/styles.css",
  "package.json",
  "shared/shortcuts.json",
  "test/unit.mjs",
  "test/ipc-handlers.mjs",
  "test/renderer-helpers.mjs",
  "test/renderer-contract.mjs",
  "test/shortcut-parity.mjs",
  "test/security.mjs",
  "test/stability.mjs",
  "test/markdown.mjs",
  "test/code-block.mjs",
  "test/e2e-rpc.mjs",
  "test/session-rpc.mjs",
  "test/dialog-smoke.mjs",
  "test/fixtures/rpc-dialog-extension.mjs",
  "README.md",
];

const write = process.argv.includes("--write");
const drifted = [];

for (const rel of files) {
  const full = path.join(guiDir, rel);
  const source = readFileSync(full, "utf8");
  const formatted = await prettier.format(source, {
    ...config,
    filepath: rel,
  });
  if (formatted !== source) {
    drifted.push(rel);
    if (write) writeFileSync(full, formatted);
  }
}

if (drifted.length === 0) {
  console.log("FORMAT OK");
} else if (write) {
  console.log(`FORMAT FIX: ${drifted.join(", ")}`);
} else {
  console.error(`FORMAT DRIFT: ${drifted.join(", ")}`);
  process.exit(1);
}
