import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { importModule } from "./shared/jiti-loader.mjs";

const performance = await importModule("extensions/setup-core/performance.ts");
const profiling = await importModule("extensions/setup-core/profiling.ts");
const workspace = mkdtempSync(path.join(tmpdir(), "pi-performance-tools-"));
try {
  mkdirSync(path.join(workspace, ".pi"));
  writeFileSync(
    path.join(workspace, ".pi", "performance.json"),
    JSON.stringify({
      profiles: {
        json: {
          program: "bench",
          args: [],
          warmups: 1,
          runs: 3,
          metricSource: "json",
          metric: "duration_ms",
          direction: "lower_is_better",
        },
      },
    }),
  );
  const loaded = performance.loadPerformanceProfiles(workspace, true);
  assert.deepEqual(Object.keys(loaded.profiles), ["json"]);
  let call = 0;
  const measured = await performance.measureProfile(
    "json",
    loaded.profiles.json,
    {
      projectRoot: workspace,
      sourceFingerprint: "source-clean",
      exec: async () => ({
        code: 0,
        stdout: JSON.stringify({ duration_ms: 10 + call++ }),
        stderr: "",
        killed: false,
      }),
    },
  );
  assert.equal(measured.warmups.length, 1);
  assert.equal(measured.successfulRuns, 3);
  assert.equal(measured.median, 12);
  const candidate = {
    ...measured,
    id: "candidate",
    samples: measured.samples.map((sample) => ({
      ...sample,
      value: (sample.value ?? 0) - 4,
    })),
    median: 8,
    mean: 8,
    min: 7,
    max: 9,
    standardDeviation: 1,
    relativeDeviation: 0.01,
  };
  assert.equal(
    performance.compareMeasurements(measured, candidate).improved,
    true,
  );

  // P0-01 regression: a real before/after benchmark run has the SAME
  // benchmarkInputFingerprint (same command/profile) but a DIFFERENT
  // sourceFingerprint (the code actually changed). This must compare, not throw.
  let afterChangeCall = 0;
  const afterCodeChange = await performance.measureProfile(
    "json",
    loaded.profiles.json,
    {
      projectRoot: workspace,
      sourceFingerprint: "source-after-change",
      exec: async () => ({
        code: 0,
        stdout: JSON.stringify({ duration_ms: 6 + afterChangeCall++ }),
        stderr: "",
        killed: false,
      }),
    },
  );
  assert.notEqual(
    measured.sourceFingerprint,
    afterCodeChange.sourceFingerprint,
  );
  assert.equal(
    measured.benchmarkInputFingerprint,
    afterCodeChange.benchmarkInputFingerprint,
  );
  const beforeAfter = performance.compareMeasurements(
    measured,
    afterCodeChange,
  );
  assert.equal(
    beforeAfter.improved,
    true,
    "faster candidate after a real code change is recognized as an improvement",
  );
  assert.equal(
    beforeAfter.sourceChanged,
    true,
    "differing sources are surfaced",
  );
  assert.equal(beforeAfter.baselineSourceFingerprint, "source-clean");
  assert.equal(beforeAfter.candidateSourceFingerprint, "source-after-change");

  // Same source, different declared input identity: must be rejected.
  const otherDataset = {
    program: "bench",
    args: [],
    cwd: ".",
    timeoutMs: 5000,
    env: {},
    warmups: 1,
    runs: 3,
    metricSource: "json",
    metric: "duration_ms",
    direction: "lower_is_better",
    inputId: "dataset-b",
    classification: "advisory",
    required: false,
    trustRequired: true,
  };
  const otherDatasetMeasured = await performance.measureProfile(
    "json",
    otherDataset,
    {
      projectRoot: workspace,
      sourceFingerprint: "source-clean",
      exec: async () => ({
        code: 0,
        stdout: JSON.stringify({ duration_ms: 10 + call++ }),
        stderr: "",
        killed: false,
      }),
    },
  );
  assert.throws(
    () => performance.compareMeasurements(measured, otherDatasetMeasured),
    /Benchmark-Eingabe/,
    "differing declared input identity is rejected even with an identical source state",
  );

  // Changed profile command (different args): must be rejected.
  const otherCommand = { ...loaded.profiles.json, args: ["--variant"] };
  const otherCommandMeasured = await performance.measureProfile(
    "json",
    otherCommand,
    {
      projectRoot: workspace,
      sourceFingerprint: "source-clean",
      exec: async () => ({
        code: 0,
        stdout: JSON.stringify({ duration_ms: 10 + call++ }),
        stderr: "",
        killed: false,
      }),
    },
  );
  assert.throws(() =>
    performance.compareMeasurements(measured, otherCommandMeasured),
  );

  // Different metric direction: must be rejected.
  assert.throws(() =>
    performance.compareMeasurements(measured, {
      ...candidate,
      direction: "higher_is_better",
    }),
  );

  // Stale/unknown result schema version: must be rejected, not silently compared.
  assert.throws(
    () =>
      performance.compareMeasurements(measured, {
        ...candidate,
        resultSchemaVersion: 1,
      }),
    /Schemaversion/,
  );
  assert.throws(
    () =>
      performance.compareMeasurements(measured, {
        ...candidate,
        resultSchemaVersion: undefined,
      }),
    /Schemaversion/,
  );

  const state = { attempts: [] };
  assert.equal(
    performance.recordExperiment(state, {
      hypothesis: "baseline",
      measurement: measured,
      correctness: "passed",
      diffFingerprint: "d1",
    }).decision,
    "kept",
  );
  assert.equal(
    performance.recordExperiment(state, {
      hypothesis: "faster",
      measurement: candidate,
      correctness: "passed",
      diffFingerprint: "d2",
    }).decision,
    "kept",
  );
  assert.equal(
    performance.recordExperiment(state, {
      hypothesis: "wrong",
      measurement: candidate,
      correctness: "failed",
      diffFingerprint: "d3",
    }).decision,
    "rejected",
  );

  writeFileSync(
    path.join(workspace, ".pi", "profiling.json"),
    JSON.stringify({
      profiles: {
        compiler: {
          adapter: "compiler-diagnostics",
          program: "cc",
          args: ["-c", "x.c"],
        },
      },
    }),
  );
  const profiles = profiling.loadProfilingProfiles(workspace, true);
  const profile = await profiling.runProfilingProfile(
    "compiler",
    profiles.profiles.compiler,
    {
      projectRoot: workspace,
      inputFingerprint: "input-v1",
      exec: async () => ({
        code: 0,
        stdout: "src/x.cc:12:3: remark: loop vectorized",
        stderr: "",
        killed: false,
      }),
    },
  );
  assert.equal(profile.status, "success");
  assert.equal(profile.findings[0].symbol, "loop vectorized");
  assert.deepEqual(
    performance.loadPerformanceProfiles(workspace, false).profiles,
    {},
  );
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
console.log("performance tools test passed");
