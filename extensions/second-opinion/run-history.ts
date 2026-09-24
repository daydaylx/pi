import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { OpinionTelemetry } from "./types.ts";

/**
 * Second opinion shares the run history with the subagent runtime
 * (`run-history.jsonl` in the agent dir, same entry shape as pi-subagents'
 * `RunEntry`), so delegated work is comparable in one place (ADR 031). It is a
 * single provider call, not a child process, so the entry stays small: no
 * question, no context, no answer — only the reason category, the decision id,
 * the outcome, latency and token counts. Best effort: history never breaks the
 * tool call.
 */
export const SECOND_OPINION_HISTORY_AGENT = "second_opinion";

export interface SecondOpinionRunEntry {
  agent: typeof SECOND_OPINION_HISTORY_AGENT;
  task: string;
  ts: number;
  status: "ok" | "error";
  duration: number;
  exit?: number;
  cwd?: string;
  tokens?: { input: number; output: number };
}

export function secondOpinionRunEntry(
  telemetry: OpinionTelemetry,
  cwd?: string,
  nowMs: number = Date.now(),
): SecondOpinionRunEntry {
  const completed = telemetry.status === "completed";
  const hasTokens =
    telemetry.inputTokens !== undefined || telemetry.outputTokens !== undefined;
  return {
    agent: SECOND_OPINION_HISTORY_AGENT,
    task: `${telemetry.reasonCategory} ${telemetry.decisionId}`.slice(0, 200),
    ts: Math.floor(nowMs / 1000),
    status: completed ? "ok" : "error",
    duration: telemetry.latencyMs ?? 0,
    // Only "completed" is a success; denied, cancelled, blocked, timeout etc.
    // are recorded as non-successes rather than hidden.
    ...(completed ? {} : { exit: 1 }),
    ...(cwd ? { cwd } : {}),
    ...(hasTokens
      ? {
          tokens: {
            input: telemetry.inputTokens ?? 0,
            output: telemetry.outputTokens ?? 0,
          },
        }
      : {}),
  };
}

export function runHistoryPath(
  env: Record<string, string | undefined> = process.env,
): string {
  const dir = env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
  return join(dir, "run-history.jsonl");
}

export function recordSecondOpinionRun(
  telemetry: OpinionTelemetry,
  cwd?: string,
  historyPath: string = runHistoryPath(),
): void {
  try {
    mkdirSync(dirname(historyPath), { recursive: true });
    appendFileSync(
      historyPath,
      `${JSON.stringify(secondOpinionRunEntry(telemetry, cwd))}\n`,
    );
  } catch {
    // Best effort: never fail the tool call over history recording.
  }
}
