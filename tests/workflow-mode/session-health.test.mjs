import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
  {
    type: "session",
    version: 3,
    id: "s1",
    timestamp: "2026-08-18T10:00:00.000Z",
  },
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
    timestamp: "2026-08-18T10:05:00.000Z",
    data: { schemaVersion: 2, timestamp: "2026-08-18T10:05:00.000Z" },
  },
  {
    type: "custom",
    customType: "resilience.turn-settled",
    timestamp: "2026-08-18T10:05:01.000Z",
    data: {
      schemaVersion: 2,
      timestamp: "2026-08-18T10:05:01.000Z",
      turnStartedAt: "2026-08-18T10:05:00.000Z",
      outcome: "aborted",
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
      provider: "openrouter",
      model: "deepseek/deepseek-v4-pro",
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
    customType: "verifier-run",
    timestamp: "2026-08-18T10:04:30.000Z",
    data: {
      timestamp: "2026-08-18T10:04:30.000Z",
      agent: "verifier",
      status: "stale",
      reason: "workspace-mutated",
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
  {
    type: "custom",
    customType: "resilience.interruption-notice",
    timestamp: "2026-08-18T11:05:00.000Z",
    data: {
      schemaVersion: 2,
      timestamp: "2026-08-18T11:05:00.000Z",
      reason: "no-result",
      entryId: "e1",
      mutatingCalls: 3,
      unconfirmedCalls: 2,
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
    writeFileSync(
      join(dir, "run-history.jsonl"),
      [
        '{"agent":"tester","task":"x","ts":1784000000,"status":"ok","duration":1}',
        '{"agent":"tester","task":"y","ts":1784000999,"status":"error","duration":1}',
        "not json",
      ].join("\n"),
    );

    const report = analyze.emptySessionHealthReport();
    for (const file of [
      join(dir, "sessions", "project-a", "one.jsonl"),
      join(dir, "sessions", "project-a", "two.jsonl"),
    ]) {
      analyze.aggregateSessionFile(file, report);
    }

    eq(report.files, 2, "both session files are read");
    eq(report.parseErrors, 1, "an unparseable line is counted, not fatal");
    eq(report.turns.total, 4, "every turn start is counted");
    eq(report.turns.completed, 1, "a clean turn is completed");
    eq(report.turns.aborted, 1, "aborted turns have a separate counter");
    eq(report.turns.failed, 2, "failed turns include schemaVersion-1 legacy");
    eq(report.turns.open, 0, "no turn is left open in the fixtures");
    eq(report.recovery.legacyRequired, 2, "legacy gate requests are counted");
    eq(report.recovery.legacyChecked, 1, "legacy gate checks are counted");
    eq(report.recovery.notices, 1, "interruption notices are counted");
    eq(
      report.recovery.unconfirmedCalls,
      2,
      "calls without a tool result are summed up",
    );
    eq(report.failures.total, 1, "failures come from resilience entries");
    eq(report.failures.byClass.stream, 1, "the stream class is reported");
    eq(report.failures.byProvider.openrouter, 1, "the provider is reported");
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
      "a denied YOLO attempt is named",
    );
    eq(report.verifier.completed, 1, "a finished verifier run is completed");
    eq(
      report.verifier.byVerdict.PASS_WITH_WARNINGS,
      1,
      "the verdict is reported",
    );
    eq(
      report.verifier.stale,
      1,
      "a run whose workspace changed meanwhile is stale, not completed",
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

await test("session health combines the three roots and counts duplicate session IDs once", () => {
  if (!sessionHealth) return;
  const dir = mkdtempSync(join(tmpdir(), "pi-session-health-roots-"));
  const roots = [
    { role: "pi-project", path: join(dir, "sessions") },
    { role: "pis-cli", path: join(dir, "profile-state/system/sessions") },
    { role: "pis-host", path: join(dir, "profile-state/system/host-sessions") },
    { role: "missing", path: join(dir, "not-created") },
  ];
  const session = (id, input) => [
    { type: "session", version: 3, id },
    {
      type: "message",
      timestamp: "2026-10-24T10:00:00.000Z",
      message: { role: "user", content: "fixture" },
    },
    {
      type: "message",
      timestamp: "2026-10-24T10:00:01.000Z",
      message: {
        role: "assistant",
        content: [{ type: "toolCall", name: "fixture-action" }],
        usage: { input, output: 2, cacheRead: 0, cost: { total: 0.01 } },
      },
    },
  ];
  const writeJsonl = (path, entries) => {
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, `${toJsonl(entries)}\n`);
  };
  try {
    writeJsonl(
      join(roots[0].path, "project-a", "project.jsonl"),
      session("shared-session", 10),
    );
    // Flat JSONL is used by the system CLI as well as the nested project layout.
    writeJsonl(join(roots[1].path, "cli.jsonl"), session("shared-session", 10));
    writeJsonl(
      join(roots[1].path, "other-cli.jsonl"),
      session("cli-session", 20),
    );
    writeJsonl(
      join(roots[2].path, "nested", "host.jsonl"),
      session("host-session", 30),
    );
    const originalFiles = [
      join(roots[0].path, "project-a", "project.jsonl"),
      join(roots[1].path, "cli.jsonl"),
      join(roots[1].path, "other-cli.jsonl"),
      join(roots[2].path, "nested", "host.jsonl"),
    ].map((path) => readFileSync(path, "utf8"));

    const collected = sessionHealth.collectSessionRoots(roots.slice(0, 3));
    eq(
      collected.report.files,
      3,
      "each unique stable session id is counted once",
    );
    eq(
      collected.report.usage.requests,
      3,
      "project, CLI, and host requests are combined",
    );
    eq(
      collected.report.usage.inputTokens,
      60,
      "a duplicate session does not double-count tokens",
    );
    eq(
      collected.report.usage.costUsd,
      0.03,
      "a duplicate session does not double-count cost",
    );
    eq(
      collected.report.usage.toolCalls,
      3,
      "a duplicate session does not double-count actions",
    );
    eq(
      collected.sources[0].report.files,
      1,
      "project sessions remain separately attributed",
    );
    eq(
      collected.sources[1].report.files,
      1,
      "the duplicate CLI session is skipped",
    );
    eq(
      collected.sources[1].deduplicatedSessions,
      1,
      "the skipped duplicate is explicit",
    );
    eq(
      collected.sources[2].report.files,
      1,
      "host sessions remain separately attributed",
    );
    eq(
      sessionHealth.collectSessionRoots([roots[3]]).sources[0].status,
      "missing",
      "a missing root is explicitly reported",
    );
    const fileRoot = join(dir, "not-a-directory.jsonl");
    writeFileSync(fileRoot, "");
    eq(
      sessionHealth.collectSessionRoots([{ role: "pis-host", path: fileRoot }])
        .sources[0].status,
      "unreadable",
      "a non-directory root is explicitly reported as unreadable",
    );
    eq(
      [
        join(roots[0].path, "project-a", "project.jsonl"),
        join(roots[1].path, "cli.jsonl"),
        join(roots[1].path, "other-cli.jsonl"),
        join(roots[2].path, "nested", "host.jsonl"),
      ].map((path) => readFileSync(path, "utf8")),
      originalFiles,
      "analysis does not migrate or modify session files",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await test("the session-health command reports without mutating anything", async () => {
  if (!sessionHealth) return;
  // Eigenes Agent-Verzeichnis mit zwei Subagenten in der Rohhistorie: Das Ergebnis
  // darf nicht von der installierten Pi-Umgebung abhängen (CI-Runner ist leer).
  const agentDir = mkdtempSync(join(tmpdir(), "pi-session-health-cmd-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const nowSeconds = Math.floor(Date.now() / 1000);
  writeFileSync(
    join(agentDir, "run-history.jsonl"),
    [
      { ts: nowSeconds, agent: "verifier", status: "ok", duration: 90_000 },
      { ts: nowSeconds, agent: "verifier", status: "error", duration: 30_000 },
      { ts: nowSeconds, agent: "temp-1", status: "ok", duration: 10_000 },
    ]
      .map((record) => JSON.stringify(record))
      .join("\n"),
  );
  try {
    await runSessionHealthCommand(agentDir);
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    rmSync(agentDir, { recursive: true, force: true });
  }
});

async function runSessionHealthCommand(agentDir) {
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
  eq(
    parsed.sessionsRoot,
    join(agentDir, "sessions"),
    "the legacy primary sessionsRoot field remains available",
  );
  eq(parsed.sources.length, 3, "all three roots appear in structured output");
  eq(
    parsed.sources[0].role,
    "pi-project",
    "project source identity is explicit",
  );
  eq(parsed.sources[1].role, "pis-cli", "CLI source identity is explicit");
  eq(parsed.sources[2].role, "pis-host", "host source identity is explicit");
  eq(
    parsed.sources[2].status,
    "missing",
    "an unavailable root is visible in JSON",
  );
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
  await harness.commands.get("session-health")("--days 1", ctx);
  assert(
    harness.notifications
      .at(-1)
      ?.message.includes("Subagent verifier: 2 Läufe"),
    "the raw history lists subagent runs, most frequent first",
  );
}

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
  eq(all.turns.total, 3, "without a window every turn start counts");
});

await test("usage metrics count requests, tool calls, tokens, cache and latency", () => {
  if (!analyze) return;
  const message = (role, extra) => ({
    type: "message",
    timestamp: "2026-08-18T10:00:00.000Z",
    message: { role, ...extra },
  });
  const entries = [
    message("user", { content: "Hallo" }),
    message("assistant", {
      stopReason: "toolUse",
      durationMs: 2000,
      usage: {
        input: 100,
        output: 10,
        cacheRead: 300,
        cost: { total: 0.5 },
      },
      content: [
        { type: "text", text: "Ich lese." },
        { type: "toolCall", id: "1", name: "read", arguments: {} },
        { type: "toolCall", id: "2", name: "bash", arguments: {} },
      ],
    }),
    message("toolResult", { toolName: "bash", isError: true, content: [] }),
    message("toolResult", { toolName: "read", isError: false, content: [] }),
    message("assistant", {
      stopReason: "error",
      durationMs: 6000,
      usage: { input: 100, output: 0, cacheRead: 100, cost: { total: 0.25 } },
      content: [],
    }),
  ];
  const report = analyze.emptySessionHealthReport();
  analyze.aggregateSessionEntries(entries, report);
  const usage = report.usage;
  eq(usage.userMessages, 1, "user messages are counted");
  eq(usage.requests, 2, "assistant messages are model requests");
  eq(usage.requestErrors, 1, "error stop reasons are counted");
  eq(usage.toolCalls, 2, "tool calls come from assistant content");
  eq(usage.toolErrors, 1, "failed tool results are counted");
  eq(usage.toolCallsByName.read, 1, "tool calls are grouped by name");
  eq(usage.toolErrorsByName.bash, 1, "tool errors are grouped by name");
  eq(
    usage.inputTokens + usage.cacheReadTokens,
    600,
    "prompt tokens are summed",
  );
  const summary = analyze.summarizeUsage(usage);
  eq(
    summary.cacheShare,
    400 / 600,
    "cache share is cache-read over prompt tokens",
  );
  eq(summary.latencyP90Ms, 6000, "p90 latency uses the slowest sample of two");
  assert(
    !("latencySamplesMs" in summary),
    "the derived summary omits the raw latency samples",
  );
  assert(
    analyze
      .formatSessionHealth(report)
      .includes("Nutzung: 1 Nutzernachrichten"),
    "the text report lists the usage line",
  );
});
