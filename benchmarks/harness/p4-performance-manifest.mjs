import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../..", import.meta.url).pathname;
const MANIFEST = join(new URL(".", import.meta.url).pathname, "p4-performance-manifest.json");

export function loadP4PerformanceManifest(path = MANIFEST) { return JSON.parse(readFileSync(path, "utf8")); }

export function validateP4PerformanceManifest(manifest, { root = ROOT } = {}) {
  if (manifest.schemaVersion !== "1.0.0" || manifest.seriesId !== "P4" || manifest.privateTaskContract !== "PI_BENCHMARK_PRIVATE_ROOT") throw new Error("P4 performance manifest has an invalid series or private-task contract.");
  if (manifest.measurement?.warmups < 2 || manifest.measurement?.runs < 7 || manifest.measurement?.primaryStatistic !== "median") throw new Error("P4 performance tasks require at least two warmups, seven runs and median scoring.");
  if (manifest.comparisonPlan?.agentRuns !== 18) throw new Error("P4 performance comparison plan must expose 18 initial agent runs.");
  const expected = ["11-cpu-hotspot", "12-allocation-layout", "13-build-dispatch"];
  if (manifest.pilotRuns?.length !== 3 || manifest.pilotRuns.some((run) => !expected.includes(run.task))) throw new Error("P4 performance manifest must provide all three pilots.");
  for (const task of expected) if (!existsSync(join(root, "benchmarks", "v2", "performance-tasks", task, "PROMPT.md"))) throw new Error(`P4 public performance prompt missing: ${task}`);
  return true;
}

/** Validate external metadata without returning its hidden inputs or paths. */
export function validatePrivatePerformanceTask(metadata) {
  const classes = {
    "11-cpu-hotspot": "cpu_algorithm",
    "12-allocation-layout": "allocation_layout",
    "13-build-dispatch": "build_dispatch",
  };
  if (!metadata || metadata.seriesId !== "P4" || classes[metadata.taskId] !== metadata.bottleneckClass) throw new Error("Private performance task has the wrong P4 identity or bottleneck class.");
  if (!Array.isArray(metadata.hiddenCorrectnessInputs) || metadata.hiddenCorrectnessInputs.length < 2 || !Array.isArray(metadata.hiddenPerformanceInputs) || metadata.hiddenPerformanceInputs.length < 2) throw new Error("Private performance task needs at least two hidden correctness and performance inputs.");
  if (metadata.measurement?.warmups < 2 || metadata.measurement?.runs < 7 || metadata.measurement?.primaryStatistic !== "median") throw new Error("Private performance task measurement protocol is incomplete.");
  if (!metadata.antiGaming?.testMutation || !metadata.antiGaming?.hardcodedInput || !metadata.antiGaming?.cleanBuild) throw new Error("Private performance task lacks required anti-gaming checks.");
  return { taskId: metadata.taskId, evaluatorFingerprint: metadata.evaluatorFingerprint, privateInputFingerprint: metadata.privateInputFingerprint };
}
