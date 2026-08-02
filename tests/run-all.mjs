/** Runs the domain-filtered regression suites in a deterministic order. */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Every domain in run.mjs's SECTION_SUITES needs an entry here, otherwise its
// sections never run in `npm test`. run.mjs itself fails when a section has no
// declared domain, which keeps the two lists honest in both directions.
const suites = [
  { name: "runtime", file: "run.mjs", env: { PI_TEST_SUITE: "runtime" } },
  { name: "ui", file: "run.mjs", env: { PI_TEST_SUITE: "ui" } },
  { name: "workflow-mode", file: "workflow-mode.mjs", env: {} },
  { name: "lsp", file: "run.mjs", env: { PI_TEST_SUITE: "lsp" } },
  {
    name: "diff",
    file: "run.mjs",
    env: { PI_TEST_SUITE: "diff" },
  },
  { name: "performance-tools", file: "performance-tools.mjs", env: {} },
  { name: "p4-manifest", file: "../benchmarks/harness/test/p4-manifest.test.mjs", env: {} },
  { name: "p4-performance-manifest", file: "../benchmarks/harness/test/p4-performance-manifest.test.mjs", env: {} },
  { name: "p4-production-stack", file: "../benchmarks/harness/test/stack-manifest.test.mjs", env: {} },
  { name: "p4-private-boundary", file: "../benchmarks/harness/test/v2-private.test.mjs", env: {} },
  { name: "p4-controller", file: "../benchmarks/harness/test/p4-controller.test.mjs", env: {} },
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
