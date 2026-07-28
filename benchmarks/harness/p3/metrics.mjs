/**
 * Reading raw run artefacts: session files, subagent activity, run metadata.
 *
 * Collection only — the scoring itself is manual (see SCORING.md) and is
 * deliberately not computed here.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fail, readJson } from "./io.mjs";

function listJsonlFiles(directory) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const candidate = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listJsonlFiles(candidate));
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(candidate);
  }
  return files.sort();
}

export function subagentSessionPaths(paths) {
  return listJsonlFiles(paths.runDir).filter((candidate) => candidate !== paths.session);
}

export function countSubagentToolCalls(sessionPath) {
  if (!existsSync(sessionPath)) return 0;
  let calls = 0;
  for (const line of readFileSync(sessionPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry?.type !== "message" || entry.message?.role !== "assistant") continue;
      for (const block of entry.message.content ?? []) {
        if (block?.type === "toolCall" && block.name === "subagent") calls += 1;
      }
    } catch {
      // The collector will treat malformed session data as unavailable rather
      // than allowing P3 to infer a subagent call from it.
    }
  }
  return calls;
}

export function subagentSpawnCap(worktree) {
  const config = readJson(
    join(worktree, "extensions", "subagent", "config.json"),
    "P3 subagent configuration",
  );
  const cap = config.maxSubagentSpawnsPerSession;
  if (!Number.isInteger(cap) || cap < 1) {
    fail("P3 subagent configuration has no valid maxSubagentSpawnsPerSession.");
  }
  return cap;
}

export function readMeta(paths) {
  return readJson(paths.meta, "P3 run metadata");
}

export function requireStatus(meta, allowed, command) {
  if (!allowed.includes(meta.status)) {
    fail(`P3 run '${meta.id}' is ${meta.status}; cannot ${command}.`);
  }
}

export function summarizedStatus(meta, paths) {
  if (meta.status !== "finished" || !existsSync(paths.resources)) {
    return meta.status;
  }
  try {
    const resources = readJson(paths.resources, "P3 launch resources");
    if (resources.launches?.some((launch) => launch.exitCode !== 0)) {
      return "invalid";
    }
  } catch {
    return "invalid";
  }
  return meta.status;
}
