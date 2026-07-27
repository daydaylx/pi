/** Runs the domain-filtered regression suites in a deterministic order. */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const suites = [
  { name: "runtime", file: "run.mjs", env: { PI_TEST_SUITE: "runtime" } },
  { name: "workflow-v3", file: "workflow-v3.mjs", env: {} },
  { name: "lsp", file: "run.mjs", env: { PI_TEST_SUITE: "lsp" } },
  {
    name: "diff-ledger",
    file: "run.mjs",
    env: { PI_TEST_SUITE: "diff-ledger" },
  },
];

for (const suite of suites) {
  console.log(`\n--- ${suite.name} suite ---`);
  const result = spawnSync(process.execPath, [path.join(__dirname, suite.file)], {
    cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, ...suite.env },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
