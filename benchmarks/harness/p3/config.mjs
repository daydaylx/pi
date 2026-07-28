/**
 * Fixed P3 parameters: paths, reference commit, model and task sets.
 *
 * Everything here is part of the benchmark contract — changing a value here
 * changes what the scored runs mean, so these are constants, not options.
 */
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// These modules live one level below the harness directory, so HERE still has
// to resolve to benchmarks/harness — the manifest and the metrics collector
// are addressed relative to it.
export const HERE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const SOURCE_ROOT = resolve(HERE, "..", "..");
export const MANIFEST_PATH = join(HERE, "p3-manifest.json");
export const METRICS_PATH = join(HERE, "collect-metrics.mjs");
export const REFERENCE = "e46915680d859ac9d6cac615cc197d5a31d46461";
export const GNU_TIME = "/usr/bin/time";
export const PI_MODEL = "opencode-go/kimi-k2.7-code";
export const PI_THINKING = "high";
export const GLOBAL_PI_BIN = join(homedir(), ".npm-global", "bin", "pi");
export const FIXTURE_TEST_TASKS = new Set([
  "02-local-bug",
  "03-failing-unit-test",
  "05-refactor-no-behavior-change",
]);
export const NO_VERIFY_TASKS = new Set([
  "06-unfamiliar-code-navigation",
  "09-hanging-tool-call",
]);
export const SECRET_LINK_NAMES = ["auth.json", "models-store.json"];
export const TASK_IDS = new Set([
  "01-single-file-change",
  "02-local-bug",
  "03-failing-unit-test",
  "04-multi-file-change",
  "05-refactor-no-behavior-change",
  "06-unfamiliar-code-navigation",
  "07-underspecified-request",
  "08-long-session-compaction",
  "09-hanging-tool-call",
  "10-with-without-subagent",
  "11-context-ledger-survival",
]);
export const LEDGER_GATE_ENV = "PI_BENCHMARK_DISABLE_LEDGER_CHECKPOINTS";
export const CONFIG_FILES = [
  "settings.json",
  "setup.json",
  "keybindings.json",
  "extensions/subagent/config.json",
  "npm/package.json",
  "npm/package-lock.json",
];

export function benchmarkEnvironmentOverrides(run) {
  // Ledger checkpoints are intentionally benchmarked only by task 11. They
  // would otherwise add an unrelated docs/CONTEXT_LEDGER.md mutation when a
  // task session shuts down, so all other tasks use the explicit gate.
  if (run.task !== "11-context-ledger-survival") {
    return { [LEDGER_GATE_ENV]: "1" };
  }
  return run.environment ?? {};
}
