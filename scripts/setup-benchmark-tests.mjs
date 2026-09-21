// Explicit, project-local installation of the pinned stdlib-only test dependency.
// Does not execute a benchmark, read credentials, or install a global package.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lock = readFileSync(
  path.join(root, "benchmarks/real-duel/OPENBENCH_LOCK"),
  "utf8",
);
const url = /^REPO_URL=(https:\/\/[^\s]+)$/m.exec(lock)?.[1];
const sha = /^PINNED_SHA=([a-f0-9]{40})$/m.exec(lock)?.[1];
if (!url || !sha) throw new Error("Invalid OPENBENCH_LOCK");
const target = path.join(root, ".agent/test-deps/openbench");
mkdirSync(path.dirname(target), { recursive: true });
if (!existsSync(target)) {
  execFileSync("git", ["clone", "--no-checkout", url, target], {
    stdio: "inherit",
  });
  execFileSync("git", ["-C", target, "checkout", "--detach", sha], {
    stdio: "inherit",
  });
}
const actual = execFileSync("git", ["-C", target, "rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const dirty = execFileSync(
  "git",
  ["-C", target, "status", "--porcelain", "--untracked-files=all"],
  { encoding: "utf8" },
).trim();
if (actual !== sha || dirty)
  throw new Error(
    "Local OpenBench is modified or has the wrong pin; not overwriting it.",
  );
execFileSync(
  "python3",
  [
    "-c",
    "import sys; assert sys.version_info >= (3, 11), 'Python >=3.11 required'",
  ],
  { stdio: "inherit" },
);
// No pip/build step: the locked source declares no third-party runtime deps.
console.log(
  `Benchmark test dependency ready: ${sha} (project-local, stdlib only)`,
);
