/** Validation for the current, separately versioned P4 benchmark series. */
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const HERE = new URL(".", import.meta.url).pathname;
const ROOT = new URL("../..", import.meta.url).pathname;
const MANIFEST = join(HERE, "p4-manifest.json");
const ACTIVE_ROLES = ["main", "investigator", "debugger", "verifier"];

export function loadP4Manifest(path = MANIFEST) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function validateP4Manifest(manifest, { root = ROOT } = {}) {
  if (manifest.schemaVersion !== "2.0.0" || manifest.seriesId !== "P4") {
    throw new Error("P4 manifest must use schema 2.0.0 and seriesId P4.");
  }
  if (manifest.privateEvaluator !== "PI_BENCHMARK_PRIVATE_ROOT") {
    throw new Error(
      "P4 manifest must require the private evaluator environment.",
    );
  }
  if (!/^[0-9a-f]{40}$/.test(manifest.reference ?? "")) {
    throw new Error("P4 manifest reference must be a full commit id.");
  }
  const git = spawnSync(
    "git",
    ["cat-file", "-e", `${manifest.reference}^{commit}`],
    { cwd: root },
  );
  if (git.status !== 0)
    throw new Error("P4 reference commit is unavailable locally.");
  for (const role of ACTIVE_ROLES) {
    const entry = manifest.roles?.[role];
    if (!entry) throw new Error(`P4 manifest is missing role '${role}'.`);
    if (role === "verifier" && entry.enabled === false) continue;
    if (typeof entry.model !== "string" || typeof entry.thinking !== "string") {
      throw new Error(`P4 role '${role}' must pin model and thinking.`);
    }
  }
  const pinned = ACTIVE_ROLES.filter(
    (role) => manifest.roles[role].enabled !== false,
  ).map((role) => manifest.roles[role].model);
  if (new Set(pinned).size !== 1)
    throw new Error(
      "P4 same-model series must pin one model across active roles.",
    );
  if (!Array.isArray(manifest.runs) || manifest.runs.length < 5) {
    throw new Error(
      "P4 manifest must include the four pilot categories and the subagent A/B pair.",
    );
  }
  for (const run of manifest.runs) {
    if (
      !/^p4-[a-z0-9-]+$/.test(run.id ?? "") ||
      run.stackMode !== "same-model"
    ) {
      throw new Error(
        "P4 runs require path-safe ids and an explicit same-model stack mode.",
      );
    }
  }
  for (const taskId of [
    "01-single-file-change",
    "02-local-bug",
    "03-failing-unit-test",
    "04-multi-file-change",
    "05-refactor-no-behavior-change",
    "06-unfamiliar-code-navigation",
    "07-underspecified-request",
    "08-long-session-compaction",
    "09-hanging-tool-call",
    "10-with-without-subagent",
  ]) {
    if (
      !existsSync(join(root, "benchmarks", "v2", "tasks", taskId, "PROMPT.md"))
    ) {
      throw new Error(
        `P4 public prompt missing for migrated task '${taskId}'.`,
      );
    }
  }
  return true;
}
