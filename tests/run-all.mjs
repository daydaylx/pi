/** Runs the domain-filtered regression suites in a deterministic order. */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const suites = ["runtime", "workflow", "lsp", "diff-ledger"];

for (const suite of suites) {
  console.log(`\n--- ${suite} suite ---`);
  const result = spawnSync(process.execPath, [path.join(__dirname, "run.mjs")], {
    cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, PI_TEST_SUITE: suite },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
