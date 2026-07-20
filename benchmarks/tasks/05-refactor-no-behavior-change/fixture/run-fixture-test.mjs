// Eigenständiger Verhaltens-Schutzwall für dieses Fixture — unabhängig von
// tests/run.mjs (diff-viewer/ ist bei diesem Referenzzustand nicht Teil des
// Haupt-Repos, siehe TASK.md). Deckt öffentliches Verhalten von ChangeTracker
// bewusst breiter ab als die eine bestehende Assertion im echten Repo, damit
// ein Refactoring hier tatsächlich geprüft werden kann.
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

function assert(condition, message) {
  if (condition) {
    passed += 1;
    return;
  }
  failed += 1;
  console.log("  FAIL: " + message);
}

{
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
    "changedFiles sorts by persisted timestamp, newest first",
  );
  eq(tracker.totalChanges, 2, "totalChanges counts all recorded changes");
}

{
  const tracker = new ChangeTracker();
  tracker.recordChange(
    "a.txt",
    "edit",
    { path: "a.txt", linesAdded: 1, linesRemoved: 0, hunks: 1 },
    [],
    10,
  );
  tracker.recordChange(
    "a.txt",
    "edit",
    { path: "a.txt", linesAdded: 2, linesRemoved: 1, hunks: 1 },
    [],
    20,
  );
  eq(
    tracker.changedFiles.map((change) => change.path),
    ["a.txt"],
    "changedFiles collapses repeated changes to the same file into one entry",
  );
  eq(
    tracker.totalChanges,
    2,
    "totalChanges still counts every recorded change, not just distinct files",
  );
  eq(
    tracker.getChangesForFile("a.txt").map((c) => c.stats.linesAdded),
    [1, 2],
    "getChangesForFile preserves full history in insertion order",
  );
}

{
  const tracker = new ChangeTracker();
  eq(tracker.changedFiles, [], "empty tracker has no changed files");
  eq(tracker.totalChanges, 0, "empty tracker has zero total changes");
  eq(
    tracker.getChangesForFile("missing.txt"),
    [],
    "unknown file returns empty history",
  );
}

{
  const tracker = new ChangeTracker();
  tracker.recordChange(
    "a.txt",
    "edit",
    { path: "a.txt", linesAdded: 1, linesRemoved: 0, hunks: 1 },
    [],
    10,
  );
  tracker.reset();
  eq(tracker.changedFiles, [], "reset clears changed files");
  eq(tracker.totalChanges, 0, "reset clears total changes");
  assert(tracker.initialized === false, "reset clears the initialized flag");
}

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
