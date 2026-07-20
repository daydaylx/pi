#!/usr/bin/env node
// Erfasst die automatisch erhebbaren Messgrößen aus SCORING.md für einen
// einzelnen Benchmark-Lauf und schreibt sie als JSON (Format siehe
// harness/schema/run-result.schema.json). Erfasst NICHTS Subjektives — die
// Felder unter "manualAssessment" bleiben immer null und müssen von einem
// Menschen ausgefüllt werden (siehe SCORING.md, Abschnitt "Automatisch vs.
// subjektiv").
//
// Nutzung:
//   node harness/collect-metrics.mjs \
//     --task <task-id> \
//     --worktree <pfad-zum-worktree> \
//     --session <pfad-zur-session-jsonl> \
//     [--session <weitere-subagent-session-jsonl> ...] \
//     [--run-history <pfad-zu-run-history.jsonl>] \
//     [--verify-result <pfad-zur-run-verify-json-ausgabe>] \
//     [--window-start <iso-timestamp>] [--window-end <iso-timestamp>]
//
// Alle Pfade sind optional; fehlende Quellen führen zu null-Feldern statt
// erfundenen Werten (siehe Änderungsregeln: keine Benchmarkergebnisse
// erfinden).
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

// Siehe harness/BASELINE.md: Referenzcommit 7b886a3 hat 5 bekannte, vom
// Agenten unabhängige Testfehlschläge, sobald verify außerhalb von
// /home/d/.pi/agent läuft. Diese werden aus der Zählung "neuer" Fehlschläge
// herausgerechnet, statt fälschlich dem Agentenlauf zugeschrieben zu werden.
const BASELINE_FAILURE_NAMES = [
  "agent start publishes a waiting state",
  "a thinking_start delta flips the status to THINKING",
  "the hidden-thinking label is kept informative while thinking streams",
  "a text delta after thinking flips the status to ANSWERING, never THINKING again",
  "a turn without any thinking delta is honestly labeled NO VISIBLE THINKING",
];

function parseArgs(argv) {
  const args = { sessions: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--task") args.task = argv[++i];
    else if (arg === "--worktree") args.worktree = argv[++i];
    else if (arg === "--session") args.sessions.push(argv[++i]);
    else if (arg === "--run-history") args.runHistory = argv[++i];
    else if (arg === "--verify-result") args.verifyResult = argv[++i];
    else if (arg === "--window-start") args.windowStart = argv[++i];
    else if (arg === "--window-end") args.windowEnd = argv[++i];
    else if (arg === "--allowed-files") args.allowedFiles = argv[++i];
  }
  return args;
}

function readJsonl(filePath) {
  if (!filePath || !existsSync(filePath)) return [];
  return readFileSync(filePath, "utf-8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((entry) => entry !== null);
}

// --- Session-Metriken (Tokenverbrauch, Modellaufrufe, Tool-Fehlschläge,
// Nutzerkorrekturen, Laufzeit, wiederholte identische Fehler) ---
function collectSessionMetrics(entries) {
  const assistantMessages = entries.filter(
    (e) => e.type === "message" && e.message?.role === "assistant",
  );
  const toolResults = entries.filter(
    (e) => e.type === "message" && e.message?.role === "toolResult",
  );
  const userMessages = entries.filter(
    (e) => e.type === "message" && e.message?.role === "user",
  );

  const tokenTotals = assistantMessages.reduce(
    (acc, e) => {
      const usage = e.message?.usage;
      if (!usage) return acc;
      acc.input += usage.input ?? 0;
      acc.output += usage.output ?? 0;
      acc.reasoning += usage.reasoning ?? 0;
      acc.total += usage.totalTokens ?? 0;
      return acc;
    },
    { input: 0, output: 0, reasoning: 0, total: 0 },
  );

  const failedToolResults = toolResults.filter(
    (e) => e.message?.isError === true,
  );

  // Wiederholte identische Fehler: gleicher toolName mit strukturell
  // identischen Argumenten, deren letztes Ergebnis isError war, danach
  // erneut mit denselben Argumenten aufgerufen. Nur automatisch zählbar,
  // ohne Bewertung, ob sich "der Kontext geändert hat" (siehe SCORING.md).
  const toolCallsById = new Map();
  for (const e of entries) {
    if (e.type !== "message") continue;
    const msg = e.message;
    if (msg?.role === "assistant" && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === "toolCall") {
          toolCallsById.set(block.id, {
            toolName: block.name,
            argsKey: JSON.stringify(block.arguments),
          });
        }
      }
    }
  }
  let lastCallKey = new Map(); // toolName+argsKey -> was the last result an error?
  let repeatedIdenticalFailures = 0;
  for (const e of toolResults) {
    const call = toolCallsById.get(e.message.toolCallId);
    if (!call) continue;
    const key = `${call.toolName}::${call.argsKey}`;
    const wasErrorBefore = lastCallKey.get(key);
    if (wasErrorBefore && e.message.isError) repeatedIdenticalFailures += 1;
    lastCallKey.set(key, e.message.isError === true);
  }

  const timestamps = entries
    .map((e) => e.timestamp)
    .filter((t) => typeof t === "string")
    .map((t) => new Date(t).getTime())
    .filter((t) => !Number.isNaN(t));
  const firstTs = timestamps.length > 0 ? Math.min(...timestamps) : null;
  const lastTs = timestamps.length > 0 ? Math.max(...timestamps) : null;

  // Erster agent_end/agent_settled-Zeitpunkt, danach folgende User-Turns
  // gelten als Nachkorrektur (Messgröße 2 in SCORING.md).
  const firstAgentEndIndex = entries.findIndex(
    (e) =>
      e.type === "custom" &&
      (e.customType === "agent_end" || e.customType === "agent_settled"),
  );
  const userTurnsAfterFirstEnd =
    firstAgentEndIndex === -1
      ? 0
      : entries
          .slice(firstAgentEndIndex + 1)
          .filter((e) => e.type === "message" && e.message?.role === "user")
          .length;

  return {
    modelCalls: assistantMessages.length,
    tokens: tokenTotals,
    failedToolCalls: failedToolResults.length,
    repeatedIdenticalFailures,
    userCorrectionTurns: userTurnsAfterFirstEnd,
    durationMs: firstTs !== null && lastTs !== null ? lastTs - firstTs : null,
    totalUserMessages: userMessages.length,
  };
}

function collectRunHistoryMetrics(entries, windowStart, windowEnd) {
  const startSec = windowStart ? new Date(windowStart).getTime() / 1000 : null;
  const endSec = windowEnd ? new Date(windowEnd).getTime() / 1000 : null;
  const inWindow = entries.filter((e) => {
    if (typeof e.ts !== "number") return false;
    if (startSec !== null && e.ts < startSec) return false;
    if (endSec !== null && e.ts > endSec) return false;
    return true;
  });
  return {
    subagentCalls: inWindow.length,
    subagentDurationMsTotal: inWindow.reduce(
      (sum, e) => sum + (e.duration ?? 0),
      0,
    ),
    subagentFailures: inWindow.filter((e) => e.status === "error").length,
  };
}

function collectDiffStat(worktreePath, allowedFiles) {
  if (!worktreePath) return null;
  let raw;
  try {
    raw = execFileSync("git", ["diff", "--numstat"], {
      cwd: worktreePath,
      encoding: "utf-8",
    });
  } catch {
    return null;
  }
  const files = raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const [added, removed, file] = line.split("\t");
      return {
        file,
        added: added === "-" ? null : Number(added),
        removed: removed === "-" ? null : Number(removed),
      };
    });
  const allowed = new Set(allowedFiles ?? []);
  const outOfScope = allowedFiles
    ? files.filter((f) => !allowed.has(f.file))
    : [];
  return {
    changedFiles: files.map((f) => f.file),
    changedFileCount: files.length,
    linesAdded: files.reduce((sum, f) => sum + (f.added ?? 0), 0),
    linesRemoved: files.reduce((sum, f) => sum + (f.removed ?? 0), 0),
    outOfScopeFiles: allowedFiles ? outOfScope.map((f) => f.file) : null,
  };
}

function collectVerifyResult(verifyResultPath) {
  if (!verifyResultPath || !existsSync(verifyResultPath)) return null;
  const raw = JSON.parse(readFileSync(verifyResultPath, "utf-8"));
  let knownFailureNames = [];
  if (raw.logFile && existsSync(raw.logFile)) {
    const log = readFileSync(raw.logFile, "utf-8");
    knownFailureNames = BASELINE_FAILURE_NAMES.filter((name) =>
      log.includes(name),
    );
  }
  const unexplainedFailure =
    raw.exitCode !== 0 &&
    knownFailureNames.length < BASELINE_FAILURE_NAMES.length;
  return {
    exitCode: raw.exitCode,
    durationMs: raw.durationMs,
    knownBaselineFailuresSeen: knownFailureNames.length,
    likelyCausedByAgent:
      raw.exitCode !== 0
        ? unexplainedFailure || knownFailureNames.length === 0
        : false,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.task) {
    console.error("Fehlt: --task <task-id>");
    process.exit(1);
  }

  const sessionEntries = args.sessions.flatMap((p) => readJsonl(p));
  const sessionMetrics = collectSessionMetrics(sessionEntries);

  const runHistoryEntries = readJsonl(args.runHistory);
  const runHistoryMetrics = collectRunHistoryMetrics(
    runHistoryEntries,
    args.windowStart,
    args.windowEnd,
  );

  const allowedFiles = args.allowedFiles
    ? args.allowedFiles.split(",").map((f) => f.trim())
    : undefined;
  const diffStat = collectDiffStat(args.worktree, allowedFiles);

  const verifyResult = collectVerifyResult(args.verifyResult);

  const result = {
    schemaVersion: "1.0.0",
    task: args.task,
    collectedAt: new Date().toISOString(),
    automatic: {
      modelCalls: sessionMetrics.modelCalls,
      tokens: sessionMetrics.tokens,
      failedToolCalls: sessionMetrics.failedToolCalls,
      repeatedIdenticalFailures: sessionMetrics.repeatedIdenticalFailures,
      userCorrectionTurns: sessionMetrics.userCorrectionTurns,
      durationMs: sessionMetrics.durationMs,
      subagentCalls: runHistoryMetrics.subagentCalls,
      subagentDurationMsTotal: runHistoryMetrics.subagentDurationMsTotal,
      subagentFailures: runHistoryMetrics.subagentFailures,
      diff: diffStat,
      verify: verifyResult,
    },
    manualAssessment: {
      solvedWithoutCorrection: null,
      unnecessaryLineChangesWithinScope: null,
      lostRequirements: null,
      repeatedFailuresWithoutContextChange: null,
      notes: null,
    },
  };

  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

main();
