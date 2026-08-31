/**
 * Thin wrapper that shells out to the unmodified, reused collect-metrics.mjs
 * for the Pi side of a P5 run, matching how RUNBOOK.md's run-baseline.sh
 * already invokes it. Deliberately omits --worktree/--verify-result: P5's
 * diff and pass/fail come from inspectAgentChanges/the private evaluator
 * instead (see p5-controller.mjs), so only the session-derived metrics
 * (tokens, model calls, tool-call failures, duration) are needed here.
 */
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { HERE } from "./config.mjs";

const COLLECT_METRICS_PATH = join(HERE, "collect-metrics.mjs");

export async function collectPiMetrics({ taskId, sessionPath, subagentCalls }) {
  const stdout = execFileSync(
    process.execPath,
    [
      COLLECT_METRICS_PATH,
      "--task",
      taskId,
      "--session",
      sessionPath,
      "--subagent-calls",
      String(subagentCalls ?? 0),
    ],
    { encoding: "utf8" },
  );
  return JSON.parse(stdout);
}
