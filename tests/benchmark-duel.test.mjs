import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const duelDir = path.join(root, "benchmarks", "duel");
if (!existsSync(duelDir)) {
  console.log("benchmark-duel: uebersprungen (benchmarks/duel fehlt)");
  process.exit(0);
}

const result = spawnSync(
  "python3",
  [
    "-m",
    "unittest",
    "discover",
    "-s",
    "benchmarks/duel",
    "-p",
    "test_*.py",
  ],
  {
    cwd: root,
    encoding: "utf8",
    timeout: 120_000,
    env: {
      ...process.env,
      PYTHONDONTWRITEBYTECODE: "1",
    },
  },
);

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) {
  console.error(
    `benchmark-duel: INFRASTRUKTUR (${result.error.code ?? result.error.message}): python3-Lauf nicht abgeschlossen`,
  );
  throw result.error;
}
if (result.status !== 0) process.exit(result.status ?? 1);
