import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const openbench = path.join(root, ".agent/test-deps/openbench");
const lock = readFileSync(
  path.join(root, "benchmarks/real-duel/OPENBENCH_LOCK"),
  "utf8",
);
const sha = /^PINNED_SHA=([a-f0-9]{40})$/m.exec(lock)?.[1];
if (!sha || !existsSync(path.join(openbench, ".git"))) {
  throw new Error(
    "Pinned OpenBench missing; run node scripts/setup-benchmark-tests.mjs (no model calls).",
  );
}
const actual = execFileSync("git", ["-C", openbench, "rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const dirty = execFileSync(
  "git",
  ["-C", openbench, "status", "--porcelain", "--untracked-files=all"],
  { encoding: "utf8" },
).trim();
if (actual !== sha || dirty)
  throw new Error(
    "OpenBench test checkout must be clean and match OPENBENCH_LOCK.",
  );
const result = spawnSync(
  "python3",
  [
    "-m",
    "unittest",
    "discover",
    "-s",
    "benchmarks/real-duel/scripts",
    "-p",
    "test_*.py",
  ],
  {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      PYTHONDONTWRITEBYTECODE: "1",
      PYTHONNOUSERSITE: "1",
      PYTHONPATH: openbench,
      PI_DUEL_OPENBENCH_HOME: openbench,
    },
  },
);

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
