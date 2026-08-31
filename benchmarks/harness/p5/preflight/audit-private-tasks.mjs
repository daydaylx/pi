#!/usr/bin/env node
// Preflight 1c: for every task referenced by the P5 manifest, checks whether
// PI_BENCHMARK_PRIVATE_ROOT/tasks/<id>/{metadata.json,evaluator.mjs} exists
// and belongs to this series. Read-only — never prints private task content.
import { loadPrivateTask, privateRoot } from "../../v2-private.mjs";
import { loadP5Manifest } from "../../p5-manifest.mjs";

function main() {
  const manifest = loadP5Manifest();
  const taskIds = [...new Set(manifest.runs.map((run) => run.task))];
  let root;
  try {
    root = privateRoot();
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({ privateRootAvailable: false, error: error.message }, null, 2)}\n`,
    );
    process.exitCode = 1;
    return;
  }
  const report = taskIds.map((taskId) => {
    try {
      const task = loadPrivateTask(root, taskId);
      return {
        taskId,
        available: true,
        seriesIdMatches: task.metadata.seriesId === "P5-LUNA-HARNESS",
      };
    } catch (error) {
      return { taskId, available: false, error: error.message };
    }
  });
  const allReady = report.every((r) => r.available && r.seriesIdMatches);
  process.stdout.write(
    `${JSON.stringify({ privateRootAvailable: true, allReady, report }, null, 2)}\n`,
  );
  if (!allReady) process.exitCode = 1;
}

main();
