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
    name: "p4-manifest",
    file: "../benchmarks/harness/test/p4-manifest.test.mjs",
    env: {},
  },
  {
    name: "p4-performance-manifest",
    file: "../benchmarks/harness/test/p4-performance-manifest.test.mjs",
    env: {},
  },
  {
    name: "p4-production-stack",
    file: "../benchmarks/harness/test/stack-manifest.test.mjs",
    env: {},
  },
  {
    name: "p4-private-boundary",
    file: "../benchmarks/harness/test/v2-private.test.mjs",
    env: {},
  },
  {
    name: "p4-controller",
    file: "../benchmarks/harness/test/p4-controller.test.mjs",
    env: {},
  },
  { name: "p4-cli", file: "../benchmarks/harness/test/p4.test.mjs", env: {} },
  {
    name: "p4-run-result-schema",
    file: "../benchmarks/harness/test/p4-run-result-schema.test.mjs",
    env: {},
  },
  { name: "check-npm-audit", file: "check-npm-audit.test.mjs", env: {} },
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
