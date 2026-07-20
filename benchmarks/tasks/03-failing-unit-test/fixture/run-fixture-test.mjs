// Eigenständiger Test für dieses Fixture — unabhängig von tests/run.mjs,
// da diff-viewer/ bei diesem Benchmark-Referenzzustand nicht Teil des
// Haupt-Repos ist (siehe TASK.md). Der Assert entspricht wörtlich der
// Section "diff viewer regressions" aus dem echten tests/run.mjs.
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Sucht "npm/node_modules/jiti" in den Elternverzeichnissen. Findet sowohl
// den Repo-Root (Original-Speicherort unter benchmarks/tasks/.../fixture/)
// als auch einen Benchmark-Worktree (dort liegt dieses Fixture direkt unter
// <worktree>/benchmark-fixture/, mit npm/node_modules als Symlink im
// Worktree selbst — siehe harness/reset-task.sh).
function findJitiEntry(startDir) {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    const candidate = path.join(dir, "npm", "node_modules", "jiti");
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("npm/node_modules/jiti not found above " + startDir);
}

const { createJiti } = require(findJitiEntry(__dirname));
const jiti = createJiti(__dirname);

const { ChangeTracker } = await jiti.import(
  path.join(__dirname, "diff-viewer/change-tracker.ts"),
);

let passed = 0;
let failed = 0;

function eq(actual, expected, message) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed += 1;
    return;
  }
  failed += 1;
  console.log(
    "  FAIL: " +
      message +
      " — expected " +
      JSON.stringify(expected) +
      ", got " +
      JSON.stringify(actual),
  );
}

const tracker = new ChangeTracker();
tracker.recordChange(
  "b.txt",
  "write",
  { path: "b.txt", linesAdded: 1, linesRemoved: 0, hunks: 1 },
  [],
  10,
);
tracker.recordChange(
  "a.txt",
  "edit",
  { path: "a.txt", linesAdded: 1, linesRemoved: 0, hunks: 1 },
  [],
  20,
);
eq(
  tracker.changedFiles.map((change) => change.path),
  ["a.txt", "b.txt"],
  "tracker sorts by persisted timestamp",
);

console.log(
  "\n" +
    (failed === 0 ? "PASS" : "FAIL") +
    ": " +
    passed +
    " passed, " +
    failed +
    " failed",
);
if (failed > 0) process.exitCode = 1;
