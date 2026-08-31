/** Validation and loading for the P6-TERRA-SUBAGENTS benchmark series. */
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const HERE = new URL(".", import.meta.url).pathname;
const ROOT = new URL("../..", import.meta.url).pathname;
const MANIFEST = join(HERE, "p6-manifest.json");
const PI_ROLES = ["main", "investigator", "debugger", "verifier"];

export function loadP6Manifest(path = MANIFEST) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function validateP6Manifest(manifest, { root = ROOT } = {}) {
  if (
    manifest.schemaVersion !== "1.0.0" ||
    manifest.seriesId !== "P6-TERRA-SUBAGENTS"
  ) {
    throw new Error(
      "P6 manifest must use schema 1.0.0 and seriesId P6-TERRA-SUBAGENTS.",
    );
  }
  if (manifest.mode !== "subagents-allowed") {
    throw new Error(
      "This P6 manifest revision only supports mode subagents-allowed.",
    );
  }
  if (manifest.privateEvaluator !== "PI_BENCHMARK_PRIVATE_ROOT") {
    throw new Error(
      "P6 manifest must require the private evaluator environment.",
    );
  }
  if (
    typeof manifest.promptSuffix !== "string" ||
    manifest.promptSuffix.length === 0
  ) {
    throw new Error("P6 manifest must define a non-empty promptSuffix.");
  }
  if (!/^[0-9a-f]{40}$/.test(manifest.reference ?? "")) {
    throw new Error("P6 manifest reference must be a full commit id.");
  }
  const git = spawnSync(
    "git",
    ["cat-file", "-e", `${manifest.reference}^{commit}`],
    { cwd: root },
  );
  if (git.status !== 0)
    throw new Error("P6 reference commit is unavailable locally.");

  const pi = manifest.harnesses?.pi;
  if (
    !pi ||
    pi.provider !== "openai-codex" ||
    pi.model !== "gpt-5.6-terra" ||
    pi.settingsOverlay !== false
  ) {
    throw new Error(
      "P6 manifest must pin the Pi harness to openai-codex/gpt-5.6-terra with no settings overlay.",
    );
  }
  for (const role of PI_ROLES) {
    const entry = pi.roles?.[role];
    if (!entry) throw new Error(`P6 Pi harness is missing role '${role}'.`);
    if (typeof entry.model !== "string" || typeof entry.thinking !== "string") {
      throw new Error(
        `P6 Pi role '${role}' must pin a model and a thinking level.`,
      );
    }
  }
  if (pi.roles.verifier?.model !== "anthropic/claude-sonnet-5") {
    throw new Error(
      "P6 requires the Pi verifier role pinned to anthropic/claude-sonnet-5 (the user's real production stack).",
    );
  }

  const codex = manifest.harnesses?.codex;
  if (
    !codex ||
    codex.model !== "gpt-5.6-terra" ||
    typeof codex.cliVersion !== "string" ||
    typeof codex.reasoningEffort !== "string" ||
    codex.sandbox !== "workspace-write" ||
    codex.networkAccess !== false
  ) {
    throw new Error(
      "P6 manifest must pin the Codex harness to gpt-5.6-terra with an explicit, fair sandbox/network configuration.",
    );
  }
  if (codex.reasoningEffort !== pi.thinking) {
    throw new Error(
      "P6 manifest must use the same reasoning effort label for both harnesses.",
    );
  }

  if (!Array.isArray(manifest.runs) || manifest.runs.length < 2) {
    throw new Error("P6 manifest must include at least the smoketest pair.");
  }
  const seenIds = new Set();
  for (const run of manifest.runs) {
    if (
      !/^p6-[a-z0-9-]+$/.test(run.id ?? "") ||
      run.stackMode !== "subagents-allowed"
    ) {
      throw new Error(
        "P6 runs require path-safe ids and an explicit subagents-allowed stack mode.",
      );
    }
    if (seenIds.has(run.id))
      throw new Error(`Duplicate P6 run id '${run.id}'.`);
    seenIds.add(run.id);
    if (run.harness !== "pi" && run.harness !== "codex") {
      throw new Error(`P6 run '${run.id}' must declare harness pi or codex.`);
    }
    if (
      !existsSync(
        join(root, "benchmarks", "v2", "tasks", run.task, "PROMPT.md"),
      )
    ) {
      throw new Error(
        `P6 public prompt missing for task '${run.task}' (run '${run.id}').`,
      );
    }
  }
  return true;
}
