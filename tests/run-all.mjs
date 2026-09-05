/** Runs the domain-filtered regression suites in a deterministic order. */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RUN_MJS_SUITES } from "./shared/run-suite-registry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// The run.mjs domains come from the same registry as the bootstrap, so a new
// section domain cannot be filtered correctly while being omitted from npm test.
const suites = [
  ...RUN_MJS_SUITES.slice(0, 2).map((name) => ({
    name,
    file: "run.mjs",
    env: { PI_TEST_SUITE: name },
  })),
  { name: "workflow-mode", file: "workflow-mode.mjs", env: {} },
  ...RUN_MJS_SUITES.slice(2).map((name) => ({
    name,
    file: "run.mjs",
    env: { PI_TEST_SUITE: name },
  })),
  {
    name: "relative-imports",
    file: "check-relative-imports.test.mjs",
    env: {},
  },
  {
    name: "compact-tool-receipts",
    file: "collapse-result.test.mjs",
    env: {},
  },
  { name: "check-npm-audit", file: "check-npm-audit.test.mjs", env: {} },
  {
    name: "check-theme-contrast",
    file: "check-theme-contrast.test.mjs",
    env: {},
  },
  {
    name: "openrouter-doctor-normalize-error",
    file: "openrouter-doctor/unit/normalize-error.test.mjs",
    env: {},
  },
  {
    name: "openrouter-doctor-status",
    file: "openrouter-doctor/unit/status.test.mjs",
    env: {},
  },
  {
    name: "openrouter-doctor-catalog",
    file: "openrouter-doctor/unit/catalog.test.mjs",
    env: {},
  },
  {
    name: "openrouter-doctor-report",
    file: "openrouter-doctor/unit/report.test.mjs",
    env: {},
  },
  {
    name: "openrouter-doctor-runner",
    file: "openrouter-doctor/integration/runner.test.mjs",
    env: {},
  },
  {
    name: "openrouter-doctor-extension",
    file: "openrouter-doctor/integration/extension.test.mjs",
    env: {},
  },
];

for (const suite of suites) {
  console.log(`\n--- ${suite.name} suite ---`);
  const result = spawnSync(
    process.execPath,
    [path.join(__dirname, suite.file)],
    {
      cwd: path.resolve(__dirname, ".."),
      env: { ...process.env, ...suite.env },
      stdio: "inherit",
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
