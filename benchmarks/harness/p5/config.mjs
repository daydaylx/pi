/**
 * Fixed P5 CLI parameters: paths, the Pi launch binary, and the Codex CLI
 * binary. Mirrors benchmarks/harness/p4/config.mjs.
 */
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const HERE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const SOURCE_ROOT = resolve(HERE, "..", "..");
export const GLOBAL_PI_BIN = join(homedir(), ".npm-global", "bin", "pi");
export const GLOBAL_CODEX_BIN = join(homedir(), ".local", "bin", "codex");
