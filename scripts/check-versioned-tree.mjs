import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { checkRelativeImports } from "./check-relative-imports.mjs";
import { npmModuleEntry } from "../tests/shared/jiti-loader.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { createJiti } = require("../npm/node_modules/jiti");

function run(command, args, options) {
  const result = spawnSync(command, args, options);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = Buffer.isBuffer(result.stderr)
      ? result.stderr.toString("utf8")
      : result.stderr ?? "";
    throw new Error(`${command} ${args.join(" ")} failed: ${detail.trim()}`);
  }
  return result;
}

function enabledExtensionEntries(exportRoot) {
  const settings = JSON.parse(readFileSync(path.join(exportRoot, "settings.json"), "utf8"));
  return (settings.extensions ?? [])
    .filter((entry) => typeof entry === "string" && entry.startsWith("+"))
    .map((entry) => entry.slice(1));
}

function createExportLoader(exportRoot) {
  const nodeModules = path.join(ROOT, "npm", "node_modules");
  const link = path.join(exportRoot, "node_modules");
  if (!existsSync(link)) symlinkSync(nodeModules, link, "dir");
  return createJiti(path.join(exportRoot, "npm", "package.json"), {
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
}

async function main() {
  const temp = mkdtempSync(path.join(tmpdir(), "pi-versioned-tree-"));
  try {
    const archive = run("git", ["archive", "--format=tar", "HEAD"], {
      cwd: ROOT,
      encoding: null,
      maxBuffer: 64 * 1024 * 1024,
    });
    run("tar", ["-xf", "-", "-C", temp], {
      input: archive.stdout,
      encoding: null,
      maxBuffer: 64 * 1024 * 1024,
    });

    const missing = checkRelativeImports(temp);
    if (missing.length > 0) {
      throw new Error(
        `versioned HEAD has unresolved literal relative imports:\n${missing
          .map((entry) => `  ${entry}`)
          .join("\n")}`,
      );
    }

    const jiti = createExportLoader(temp);
    for (const entry of enabledExtensionEntries(temp)) {
      const mod = await jiti.import(path.join(temp, entry));
      if (typeof mod?.default !== "function") {
        throw new Error(`active extension has no default factory: ${entry}`);
      }
    }
    console.log("PASS: versioned HEAD resolves relative imports and loads every active extension");
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
