import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { performance } from "node:perf_hooks";
import { syncBuiltinESMExports } from "node:module";
const originalWriteFile = fs.writeFileSync;
const originalFsync = fs.fsyncSync;
let bytesWritten = 0;
let fsyncDurations = [];
fs.writeFileSync = function (file, data, ...args) {
  if (typeof file === "number" && typeof data === "string")
    bytesWritten += Buffer.byteLength(data);
  return originalWriteFile.call(this, file, data, ...args);
};
fs.fsyncSync = function (fd) {
  const start = performance.now();
  try {
    return originalFsync.call(this, fd);
  } finally {
    fsyncDurations.push(performance.now() - start);
  }
};
syncBuiltinESMExports();
const { RunStore } = await import(
  new URL("../../frontend-server/runs.mjs", import.meta.url)
);
const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-m19-runstore-"));
const runsDir = path.join(root, "runs");
const store = new RunStore({ runsDir, hostEpoch: "bench-epoch" });
const rows = [];
function sample(label, operation) {
  bytesWritten = 0;
  fsyncDurations = [];
  const start = performance.now();
  operation();
  const elapsed = performance.now() - start;
  const file = fs.readdirSync(runsDir).find((entry) => entry.endsWith(".json"));
  const size = fs.statSync(path.join(runsDir, file)).size;
  rows.push({
    label,
    size,
    bytes: bytesWritten,
    fsyncs: fsyncDurations.length,
    fsyncMs: fsyncDurations.reduce((a, b) => a + b, 0),
    elapsed,
  });
}
let run;
sample("submit", () => {
  run = store.createRun({
    sessionId: "bench-session",
    message: "Manifest I/O measurement",
    clientSubmissionId: "bench-submit",
  });
});
sample("tool.start", () =>
  store.recordToolStarted(run, {
    toolCallId: "bench-0",
    toolName: "read",
    args: { path: "/tmp/bench-file" },
  }),
);
sample("tool.finish", () =>
  store.recordToolFinished(run, {
    toolCallId: "bench-0",
    toolName: "read",
    isError: false,
  }),
);
for (let i = 1; i <= 200; i++) {
  store.recordToolStarted(run, {
    toolCallId: `bench-${i}`,
    toolName: "read",
    args: { path: `/tmp/bench-file-${i}` },
  });
  store.recordToolFinished(run, {
    toolCallId: `bench-${i}`,
    toolName: "read",
    isError: false,
  });
  if ([10, 50, 100, 200].includes(i)) {
    const file = path.join(runsDir, `${run.runId}.json`);
    process.stdout.write(
      `history ${i} actions: ${fs.statSync(file).size} bytes\n`,
    );
    sample(`tool.start @${i}`, () =>
      store.recordToolStarted(run, {
        toolCallId: `probe-${i}`,
        toolName: "read",
        args: { path: `/tmp/probe-${i}` },
      }),
    );
    sample(`tool.finish @${i}`, () =>
      store.recordToolFinished(run, {
        toolCallId: `probe-${i}`,
        toolName: "read",
        isError: false,
      }),
    );
  }
}
sample("finalize", () => store.settleTurn(run));
for (const row of rows)
  process.stdout.write(
    `${row.label}: manifest=${row.size}B write=${row.bytes}B fsyncs=${row.fsyncs} fsync=${row.fsyncMs.toFixed(3)}ms total=${row.elapsed.toFixed(3)}ms\n`,
  );
const syncs = [];
let timedRun = store.createRun({
  sessionId: "bench-session",
  message: "timing sample",
});
for (let i = 0; i < 100; i++) {
  fsyncDurations = [];
  store.recordToolStarted(timedRun, {
    toolCallId: `timed-${i}`,
    toolName: "read",
    args: { path: `/tmp/timed-${i}` },
  });
  syncs.push(fsyncDurations.reduce((a, b) => a + b, 0));
}
syncs.sort((a, b) => a - b);
process.stdout.write(
  `100 tool.start persist fsync-pair: median=${syncs[50].toFixed(3)}ms p95=${syncs[95].toFixed(3)}ms max=${syncs.at(-1).toFixed(3)}ms\n`,
);
fs.rmSync(root, { recursive: true, force: true });
