/**
 * Counting real subagent tool calls and reading the configured spawn cap.
 *
 * Shared between the P3 and P4 controllers (extracted from p3/metrics.mjs,
 * which now re-exports these) so both series enforce the with/without-
 * subagent A/B variant the same way instead of maintaining two copies.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

function fail(message) {
  throw new Error(message);
}

function readJson(path, description) {
  if (!existsSync(path)) fail(`${description} is missing.`);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    fail(`${description} is not valid JSON.`);
  }
}

export function countSubagentToolCalls(sessionPath) {
  if (!existsSync(sessionPath)) return 0;
  let calls = 0;
  for (const line of readFileSync(sessionPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry?.type !== "message" || entry.message?.role !== "assistant")
        continue;
      for (const block of entry.message.content ?? []) {
        if (block?.type === "toolCall" && block.name === "subagent") calls += 1;
      }
    } catch {
      // Malformed session data is treated as unavailable rather than
      // allowing a variant check to infer a subagent call from it.
    }
  }
  return calls;
}

export function subagentSpawnCap(worktree) {
  const config = readJson(
    join(worktree, "extensions", "subagent", "config.json"),
    "Subagent configuration",
  );
  const cap = config.maxSubagentSpawnsPerSession;
  if (!Number.isInteger(cap) || cap < 1) {
    fail("Subagent configuration has no valid maxSubagentSpawnsPerSession.");
  }
  return cap;
}

/**
 * `without-subagent` tolerates zero subagent calls; `with-subagent`
 * tolerates any count up to the configured session cap (it does not require
 * at least one call — matching the existing P3 semantics this is extracted
 * from, not a new, stricter rule).
 */
export function isVariantViolation(variant, subagentCalls, subagentCap) {
  return (
    (variant === "without-subagent" && subagentCalls > 0) ||
    (variant === "with-subagent" && subagentCalls > subagentCap)
  );
}
