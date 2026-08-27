/**
 * Aggregates individual check results into exactly one of the three
 * documented statuses. Pure and table-driven so it stays trivially testable
 * — see README "Grenzen": HEALTHY only ever claims "worked at test time".
 */
import type { CheckResult, OverallStatus } from "../types.ts";

/**
 * Only these three checks stand for "the model works at all". A no-endpoints
 * failure on a *deep* check (strict-parameters, tools, reasoning) means the
 * model works but not with everything Pi asked for in that request — that is
 * DEGRADED, not BROKEN. Only a no-endpoints (or any other) failure on basic
 * inference itself means nothing usable is available — that is BROKEN.
 */
const BROKEN_CHECK_IDS = new Set(["catalog", "auth", "inference"]);

function isBrokenTrigger(check: CheckResult): boolean {
  return check.status === "fail" && BROKEN_CHECK_IDS.has(check.id);
}

/** HEALTHY requires every check to have actually confirmed success. */
export function aggregateStatus(checks: readonly CheckResult[]): OverallStatus {
  if (checks.length === 0) return "BROKEN";
  if (checks.some(isBrokenTrigger)) return "BROKEN";
  const allHealthy = checks.every((check) => check.status === "ok");
  return allHealthy ? "HEALTHY" : "DEGRADED";
}
