// Eigenständiger Test für dieses Fixture — unabhängig von tests/run.mjs,
// da diff-viewer/ bei diesem Benchmark-Referenzzustand nicht Teil des
// Haupt-Repos ist (siehe TASK.md).
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

const { computeLineDiff, scriptToHunks } = await jiti.import(
  path.join(__dirname, "diff-viewer/diff-algorithm.ts"),
);

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed += 1;
    return;
  }
  failed += 1;
  console.log("  FAIL: " + message);
}

// Bestehendes Verhalten (bleibt nach dem Fix unverändert):
// Änderungen mit echtem Abstand > 2*contextLines+1 bleiben getrennte Hunks.
{
  const before = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
  const after = before
    .replace("line 2", "line two")
    .replace("line 17", "line seventeen");
  const script = computeLineDiff(before.split("\n"), after.split("\n"));
  const hunks = scriptToHunks(before.split("\n"), after.split("\n"), script);
  assert(hunks.length === 2, "distant changes stay in separate hunks");
}

// Regressionsfall für den injizierten Bug: zwei Änderungen mit exakt
// contextLines*2+1 = 7 Zeilen Abstand (contextLines Default = 3) müssen zu
// einem einzigen zusammenhängenden Hunk verschmelzen. Mit der kaputten
// Bedingung `<` statt `<=` werden sie fälschlich getrennt.
{
  const lines = Array.from({ length: 20 }, (_, i) => `line ${i}`);
  const before = lines.join("\n");
  const after = lines
    .map((l, i) => (i === 2 ? "line two" : i === 9 ? "line nine" : l))
    .join("\n");
  const script = computeLineDiff(before.split("\n"), after.split("\n"));
  const hunks = scriptToHunks(before.split("\n"), after.split("\n"), script);
  assert(
    hunks.length === 1,
    "changes exactly 2*contextLines+1 apart merge into one hunk (regression for the injected off-by-one)",
  );
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
