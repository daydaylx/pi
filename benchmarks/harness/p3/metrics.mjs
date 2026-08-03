/**
 * Reading raw run artefacts: session files, subagent activity, run metadata.
 *
 * Collection only — the scoring itself is manual (see SCORING.md) and is
 * deliberately not computed here.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fail, readJson } from "./io.mjs";

// Extracted to ../subagent-variant.mjs so P3 and P4 share one implementation
// of subagent-call counting and cap reading; re-exported here so existing P3
// imports keep working unchanged.
export {
  countSubagentToolCalls,
  subagentSpawnCap,
} from "../subagent-variant.mjs";

function listJsonlFiles(directory) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const candidate = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listJsonlFiles(candidate));
    else if (entry.isFile() && entry.name.endsWith(".jsonl"))
      files.push(candidate);
  }
  return files.sort();
}

export function subagentSessionPaths(paths) {
  return listJsonlFiles(paths.runDir).filter(
    (candidate) => candidate !== paths.session,
  );
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
