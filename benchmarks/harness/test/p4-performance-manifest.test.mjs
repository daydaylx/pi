import assert from "node:assert/strict";
import { loadP4PerformanceManifest, validateP4PerformanceManifest, validatePrivatePerformanceTask } from "../p4-performance-manifest.mjs";

const manifest = loadP4PerformanceManifest();
assert.equal(validateP4PerformanceManifest(manifest), true);
assert.throws(() => validateP4PerformanceManifest({ ...manifest, measurement: { ...manifest.measurement, runs: 6 } }), /seven runs/);
assert.equal(validatePrivatePerformanceTask({ taskId: "11-cpu-hotspot", seriesId: "P4", bottleneckClass: "cpu_algorithm", hiddenCorrectnessInputs: ["a", "b"], hiddenPerformanceInputs: ["a", "b"], measurement: { warmups: 2, runs: 7, primaryStatistic: "median" }, antiGaming: { testMutation: true, hardcodedInput: true, cleanBuild: true }, evaluatorFingerprint: "v1", privateInputFingerprint: "i1" }).taskId, "11-cpu-hotspot");
assert.throws(() => validatePrivatePerformanceTask({ taskId: "11-cpu-hotspot", seriesId: "P4", bottleneckClass: "cpu_algorithm" }), /hidden correctness/);
console.log("P4 performance manifest test passed.");
