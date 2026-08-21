import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, eq, test } from "../shared/assertions.mjs";
import { createHarness } from "../shared/harness.mjs";
import { importModule as load } from "../shared/jiti-loader.mjs";

const analyze = await load("extensions/session-health/analyze.ts");
const sessionHealth = await load("extensions/session-health/index.ts");

/**
 * Eine interaktive Session mit sauberem Turn, Fehlturn mit Recovery,
 * Providerfehler und einem vollständigen sowie einem abgebrochenen
 * Verifier-Lauf.
 */
const HEALTHY_SESSION = [
  { type: "session", version: 3, id: "s1", timestamp: "2026-08-18T10:00:00.000Z" },
  {
    type: "custom",
    customType: "resilience.turn-start",
    timestamp: "2026-08-18T10:00:01.000Z",
    data: { schemaVersion: 2, timestamp: "2026-08-18T10:00:01.000Z" },
  },
  {
    type: "custom",
    customType: "resilience.turn-settled",
    timestamp: "2026-08-18T10:00:02.000Z",
    data: {
      schemaVersion: 2,
      timestamp: "2026-08-18T10:00:02.000Z",
      turnStartedAt: "2026-08-18T10:00:01.000Z",
      outcome: "completed",
      observedFailureCount: 0,
    },
  },
  {
    type: "custom",
    customType: "resilience.turn-start",
    timestamp: "2026-08-18T10:01:00.000Z",
    data: { schemaVersion: 2, timestamp: "2026-08-18T10:01:00.000Z" },
  },
  {
    type: "custom",
    customType: "resilience.failure",
    timestamp: "2026-08-18T10:01:01.000Z",
    data: {
      schemaVersion: 2,
      timestamp: "2026-08-18T10:01:01.000Z",
      provider: "qwen-token-plan-individual",
      model: "qwen3.8-max",
      errorClass: "stream",
      errorCode: "STREAM_PHASE",
      phase: "streaming_text",
    },
  },
  {
    type: "custom",
    customType: "resilience.turn-settled",
    timestamp: "2026-08-18T10:01:02.000Z",
    data: {
      schemaVersion: 2,
      timestamp: "2026-08-18T10:01:02.000Z",
      turnStartedAt: "2026-08-18T10:01:00.000Z",
      outcome: "failed",
      observedFailureCount: 1,
      recoveryPending: true,
    },
  },
  {
    type: "custom",
    customType: "resilience.recovery-required",
    timestamp: "2026-08-18T10:01:03.000Z",
    data: {
      schemaVersion: 2,
      timestamp: "2026-08-18T10:01:03.000Z",
      turnStartedAt: "2026-08-18T10:01:00.000Z",
      reason: "final_failure",
      workspaceChangedSinceTurnStart: false,
      toolMayHaveMutatedWorkspace: true,
    },
  },
  {
    type: "custom",
    customType: "permission-transition",
    timestamp: "2026-08-18T10:02:00.000Z",
    data: {
      timestamp: "2026-08-18T10:02:00.000Z",
      source: "command",
      state: "YOLO_OVERRIDE",
    },
  },
  {
    type: "custom",
    customType: "permission-transition-denied",
    timestamp: "2026-08-18T10:02:01.000Z",
    data: {
      timestamp: "2026-08-18T10:02:01.000Z",
      source: "command",
      attemptedLevel: "yolo",
      mode: "simple_plan",
    },
  },
  {
    type: "custom",
    customType: "verifier-run",
    timestamp: "2026-08-18T10:03:00.000Z",
    data: {
      timestamp: "2026-08-18T10:03:00.000Z",
      agent: "verifier",
      status: "completed",
      verdict: "PASS_WITH_WARNINGS",
    },
  },
  {
    type: "custom",
    customType: "verifier-run",
    timestamp: "2026-08-18T10:04:00.000Z",
    data: {
      timestamp: "2026-08-18T10:04:00.000Z",
      agent: "verifier",
      status: "incomplete",
      reason: "turn-budget",
    },
  },
  {
    type: "custom",
    customType: "resilience.compaction-boundary",
    timestamp: "2026-08-18T10:05:00.000Z",
    data: {
      schemaVersion: 2,
      timestamp: "2026-08-18T10:05:00.000Z",
      boundary: "failed",
      reason: "threshold",
    },
  },
];

/** Eine Sitzung mit geprüftem Recovery-Gate und schemaVersion-1-Altbestand. */
const CHECKED_SESSION = [
  {
    type: "custom",
    customType: "resilience.turn-start",
    timestamp: "2026-08-18T11:00:00.000Z",
    data: { schemaVersion: 1, timestamp: "2026-08-18T11:00:00.000Z" },
  },
  {
    type: "custom",
    customType: "resilience.turn-settled",
    timestamp: "2026-08-18T11:00:01.000Z",
    data: {
      schemaVersion: 1,
      timestamp: "2026-08-18T11:00:01.000Z",
      turnStartedAt: "2026-08-18T11:00:00.000Z",
      outcome: "failed",
      observedFailureCount: 1,
    },
  },
  {
    type: "custom",
    customType: "resilience.recovery-required",
    timestamp: "2026-08-18T11:00:02.000Z",
    data: {
      schemaVersion: 1,
      timestamp: "2026-08-18T11:00:02.000Z",
      turnStartedAt: "2026-08-18T11:00:00.000Z",
      reason: "final_failure",
      workspaceChangedSinceTurnStart: true,
      toolMayHaveMutatedWorkspace: false,
    },
  },
  {
    type: "custom",
    customType: "resilience.recovery-checked",
    timestamp: "2026-08-18T11:00:03.000Z",
    data: {
      schemaVersion: 2,
      timestamp: "2026-08-18T11:00:03.000Z",
      turnStartedAt: "2026-08-18T11:00:00.000Z",
      workspaceFingerprint: "abc",
    },
  },
];

function toJsonl(entries) {
  return entries.map((entry) => JSON.stringify(entry)).join("\n");
}

await test("session health separates interactive errors from raw history", () => {
  if (!analyze) return;
  const dir = mkdtempSync(join(tmpdir(), "pi-session-health-"));
  try {
    mkdirSync(join(dir, "sessions", "project-a"), { recursive: true });
    writeFileSync(
      join(dir, "sessions", "project-a", "one.jsonl"),
      `${toJsonl(HEALTHY_SESSION)}\n{kein json`,
    );
    writeFileSync(
      join(dir, "sessions", "project-a", "two.jsonl"),
      toJsonl(CHECKED_SESSION),
    );
    writeFileSync(join(dir, "run-history.jsonl"), [
      '{"agent":"tester","task":"x","ts":1784000000,"status":"ok","duration":1}',
      '{"agent":"tester","task":"y","ts":1784000999,"status":"error","duration":1}',
      "not json",
    ].join("\n"));

    const report = analyze.emptySessionHealthReport();
    for (const file of [
      join(dir, "sessions", "project-a", "one.jsonl"),
      join(dir, "sessions", "project-a", "two.jsonl"),
    ]) {
      analyze.aggregateSessionFile(file, report);
    }

    eq(report.files, 2, "both session files are read");
    eq(report.parseErrors, 1, "an unparseable line is counted, not fatal");
    eq(report.turns.total, 3, "every turn start is counted");
    eq(report.turns.completed, 1, "a clean turn is completed");
    eq(report.turns.failed, 2, "failed turns include schemaVersion-1 legacy");
    eq(report.turns.open, 0, "no turn is left open in the fixtures");
    eq(report.recovery.required, 2, "recovery requests are counted");
    eq(report.recovery.checked, 1, "recovery checks are counted");
    eq(
      report.recovery.uncheckedGates,
      1,
      "only the session without a check reports an open gate",
    );
    eq(report.failures.total, 1, "failures come from resilience entries");
    eq(report.failures.byClass.stream, 1, "the stream class is reported");
    eq(
      report.failures.byProvider["qwen-token-plan-individual"],
      1,
      "the provider is reported",
    );
    eq(report.failures.byPhase.streaming_text, 1, "the phase is reported");
    eq(report.permissions.transitions, 1, "permission transitions are counted");
    eq(
      report.permissions.yoloOverrides,
      1,
      "YOLO overrides are visible without inflating error rates",
    );
    eq(report.permissions.denied, 1, "denied transitions are counted");
    eq(
      report.permissions.deniedYoloAttempts,
      1,
      "the denied YOLO attempt in plan mode is named",
    );
    eq(report.verifier.completed, 1, "a finished verifier run is completed");
    eq(
      report.verifier.byVerdict.PASS_WITH_WARNINGS,
      1,
      "the verdict is reported",
    );
    eq(report.verifier.incomplete, 1, "an aborted verifier run is incomplete");
    eq(
      report.verifier.incompleteReasons["turn-budget"],
      1,
      "the incomplete reason is reported",
    );
    eq(report.compactionFailures, 1, "a failed compaction is reported");

    const text = analyze.formatSessionHealth(report);
    assert(text.includes("Session-Health"), "the report has a header");
    assert(
      !/Gesamtfehlerquote|Fehlerquote/i.test(text),
      "no artificial overall error rate is invented",
    );
    assert(
      text.includes("run-history.jsonl"),
      "the raw history is mentioned only as a hint",
    );

    const rawHistory = sessionHealth.summarizeRawHistory(
      join(dir, "run-history.jsonl"),
    );
    eq(rawHistory.lines, 3, "raw history stays a raw line count");
    eq(rawHistory.lastTs, 1784000999, "raw history keeps its last timestamp");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await test("session health arguments and file collection are bounded", () => {
  if (!sessionHealth) return;
  eq(sessionHealth.parseSessionHealthArgs("").json, false, "defaults are off");
  eq(sessionHealth.parseSessionHealthArgs("--json").json, true, "--json works");
  eq(
    sessionHealth.parseSessionHealthArgs("--days 7").days,
    7,
    "--days accepts a positive integer",
  );
  assert(
    sessionHealth.parseSessionHealthArgs("--days 0").error,
    "--days rejects zero",
  );
  assert(
    sessionHealth.parseSessionHealthArgs("--nope").error,
    "unknown arguments are refused",
  );

  const dir = mkdtempSync(join(tmpdir(), "pi-session-health-files-"));
  try {
    mkdirSync(join(dir, "proj"), { recursive: true });
    writeFileSync(join(dir, "proj", "a.jsonl"), "{}\n");
    writeFileSync(join(dir, "proj", "notes.txt"), "ignore me");
    const all = sessionHealth.collectSessionFiles(dir);
    eq(all.length, 1, "only session JSONLs are collected");
    eq(
      sessionHealth.collectSessionFiles(dir, Date.now() + 60_000).length,
      0,
      "the time window filters by file age",
    );
    eq(
      sessionHealth.collectSessionFiles(join(dir, "missing")).length,
      0,
      "a missing sessions root is not an error",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await test("the session-health command reports without mutating anything", async () => {
  if (!sessionHealth) return;
  const harness = createHarness();
  sessionHealth.default(harness.api);
  const ctx = harness.makeContext();

  await harness.commands.get("session-health")("--nope", ctx);
  assert(
    harness.notifications.at(-1)?.level === "error" &&
      harness.notifications.at(-1)?.message.includes("/session-health"),
    "unknown arguments are refused with a usage hint",
  );

  await harness.commands.get("session-health")("--days 1 --json", ctx);
  const jsonNotice = harness.notifications.at(-1);
  eq(jsonNotice.level, "info", "a valid report is a normal notification");
  const parsed = JSON.parse(jsonNotice.message);
  eq(parsed.windowDays, 1, "the window is applied");
  assert(
    parsed.report && typeof parsed.report.turns === "object",
    "the JSON payload carries the structured report",
  );

  await harness.commands.get("session-health")("", ctx);
  assert(
    harness.notifications
      .at(-1)
      ?.message.startsWith("Session-Health (gesamte Historie)"),
    "the text report names its window",
  );
});

await test("the time window keeps recent entries and drops older ones", () => {
  if (!analyze) return;
  const report = analyze.emptySessionHealthReport();
  const since = Date.parse("2026-08-18T10:30:00.000Z");
  analyze.aggregateSessionEntries(HEALTHY_SESSION, report, since);
  eq(
    report.turns.total,
    0,
    "entries before the window are not counted as turns",
  );
  eq(
    report.verifier.incomplete,
    0,
    "entries before the window are not counted as verifier runs",
  );
  const all = analyze.emptySessionHealthReport();
  analyze.aggregateSessionEntries(HEALTHY_SESSION, all);
  eq(all.turns.total, 2, "without a window every entry counts");
});
