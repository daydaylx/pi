/**
 * Codex-side equivalent of collect-metrics.mjs. Produces the same
 * `automatic`-shaped object (see run-result.schema.json#/properties/automatic)
 * from a Codex CLI rollout JSONL instead of a Pi session JSONL, so P5's
 * RESULTS.md can place both harnesses' metrics side by side under identical
 * field semantics.
 *
 * Field structure below is CALIBRATED against a real captured rollout file
 * (2026-08-31, codex-cli 0.149.1), not guessed from documentation:
 *
 * - Token usage: `event_msg` entries with `payload.type === "token_count"`
 *   carry `payload.info.total_token_usage` as a CUMULATIVE running total
 *   (input_tokens, cached_input_tokens, cache_write_input_tokens,
 *   output_tokens, reasoning_output_tokens, total_tokens) — the LAST such
 *   event in the file holds the final totals for the whole run. Summing
 *   across all token_count events would massively overcount, since they are
 *   not deltas.
 * - Model calls: `response_item` entries with `payload.type === "message"
 *   && payload.role === "assistant"` — one per visible agent turn, matching
 *   Pi's `assistantMessages.length` semantics. Cross-checked against
 *   `event_msg.item_completed` entries where `item.type === "AgentMessage"`
 *   (identical count in the calibration sample).
 * - Tool calls: `event_msg.item_completed` entries where
 *   `item.type === "CommandExecution"`; failures identified by
 *   `item.status === "failed"` (equivalently `item.exit_code !== 0`).
 */
import { existsSync, readFileSync } from "node:fs";

function readJsonlEntries(rolloutPath) {
  if (!rolloutPath || !existsSync(rolloutPath)) return [];
  return readFileSync(rolloutPath, "utf8")
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

function itemCompletedItems(entries) {
  return entries
    .filter(
      (e) => e.type === "event_msg" && e.payload?.type === "item_completed",
    )
    .map((e) => e.payload.item)
    .filter(Boolean);
}

/**
 * @param {string} taskId
 * @param {string} rolloutPath absolute path to the Codex rollout JSONL
 * @param {object} [launchSessionMetrics] the launcher's own wall-clock/exit
 *   measurement, used as a durationMs fallback when the rollout's own
 *   timestamps cannot be parsed (clearly distinguished in the return value).
 */
export function collectCodexMetrics({
  taskId,
  rolloutPath,
  launchSessionMetrics,
}) {
  const entries = readJsonlEntries(rolloutPath);

  const assistantMessages = entries.filter(
    (e) =>
      e.type === "response_item" &&
      e.payload?.type === "message" &&
      e.payload?.role === "assistant",
  );

  const items = itemCompletedItems(entries);
  const commandExecutions = items.filter(
    (item) => item.type === "CommandExecution",
  );
  const failedCommandExecutions = commandExecutions.filter(
    (item) => item.status === "failed" || item.exit_code !== 0,
  );

  const tokenCountEvents = entries
    .filter((e) => e.type === "event_msg" && e.payload?.type === "token_count")
    .map((e) => e.payload.info?.total_token_usage)
    .filter(Boolean);
  const lastTokenUsage =
    tokenCountEvents.length > 0
      ? tokenCountEvents[tokenCountEvents.length - 1]
      : null;

  const timestamps = entries
    .map((entry) => entry.timestamp)
    .filter((t) => typeof t === "string")
    .map((t) => new Date(t).getTime())
    .filter((t) => !Number.isNaN(t));
  const rolloutDurationMs =
    timestamps.length > 0
      ? Math.max(...timestamps) - Math.min(...timestamps)
      : null;

  const turnContext =
    entries.find((e) => e.type === "turn_context")?.payload ?? null;
  const multiAgentThreadDetected = Boolean(
    turnContext?.multi_agent_version &&
    entries.some((e) => e.type === "thread_spawn"),
  );

  return {
    schemaVersion: "1.1.0-codex",
    task: taskId,
    collectedAt: new Date().toISOString(),
    automatic: {
      modelCalls: assistantMessages.length,
      tokens: lastTokenUsage
        ? {
            input: lastTokenUsage.input_tokens ?? null,
            output: lastTokenUsage.output_tokens ?? null,
            reasoning: lastTokenUsage.reasoning_output_tokens ?? null,
            cacheRead: lastTokenUsage.cached_input_tokens ?? null,
            cacheWrite: lastTokenUsage.cache_write_input_tokens ?? null,
            providerReportedTotal: lastTokenUsage.total_tokens ?? null,
          }
        : {
            input: null,
            output: null,
            reasoning: null,
            cacheRead: null,
            cacheWrite: null,
            providerReportedTotal: null,
          },
      failedToolCalls:
        commandExecutions.length > 0 ? failedCommandExecutions.length : null,
      repeatedIdenticalFailures: null, // requires per-call argument matching; not yet implemented for Codex's call shape
      userCorrectionTurns: null, // Core-Parity: single-shot `codex exec`, no interactive follow-up turns possible
      durationMs: rolloutDurationMs ?? launchSessionMetrics?.durationMs ?? null,
      durationMsSource:
        rolloutDurationMs !== null
          ? "rollout-timestamps"
          : "launcher-wall-clock",
      subagentCalls: multiAgentThreadDetected ? null : 0,
      subagentModelCalls: 0,
      subagentTokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cacheRead: null,
        cacheWrite: null,
        providerReportedTotal: 0,
      },
      subagentDurationMsTotal: 0,
      subagentFailures: 0,
      toolCallCount: commandExecutions.length,
      diff: null, // computed at the top-level P5 result's `diff` field instead (harness-neutral)
      verify: null, // determined by the private evaluator instead
    },
    manualAssessment: {
      solvedWithoutCorrection: null,
      unnecessaryLineChangesWithinScope: null,
      lostRequirements: null,
      repeatedFailuresWithoutContextChange: null,
      decisionPersistenceAfterCompaction: null,
      projectStatusCorrectness: null,
      hallucinationCount: null,
      notes: null,
    },
  };
}
