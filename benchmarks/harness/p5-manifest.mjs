/** Validation and loading for the P5-LUNA-HARNESS benchmark series. */
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const HERE = new URL(".", import.meta.url).pathname;
const ROOT = new URL("../..", import.meta.url).pathname;
const MANIFEST = join(HERE, "p5-manifest.json");
const PI_ROLES = ["main", "investigator", "debugger", "verifier"];

export function loadP5Manifest(path = MANIFEST) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function validateP5Manifest(manifest, { root = ROOT } = {}) {
  if (
    manifest.schemaVersion !== "1.0.0" ||
    manifest.seriesId !== "P5-LUNA-HARNESS"
  ) {
    throw new Error(
      "P5 manifest must use schema 1.0.0 and seriesId P5-LUNA-HARNESS.",
    );
  }
  if (manifest.mode !== "core-parity") {
    throw new Error(
      "This P5 manifest revision only supports mode core-parity.",
    );
  }
  if (manifest.privateEvaluator !== "PI_BENCHMARK_PRIVATE_ROOT") {
    throw new Error(
      "P5 manifest must require the private evaluator environment.",
    );
  }
  if (!/^[0-9a-f]{40}$/.test(manifest.reference ?? "")) {
    throw new Error("P5 manifest reference must be a full commit id.");
  }
  const git = spawnSync(
    "git",
    ["cat-file", "-e", `${manifest.reference}^{commit}`],
    { cwd: root },
  );
  if (git.status !== 0)
    throw new Error("P5 reference commit is unavailable locally.");

  const pi = manifest.harnesses?.pi;
  if (!pi || pi.provider !== "openai-codex" || pi.model !== "gpt-5.6-luna") {
    throw new Error(
      "P5 manifest must pin the Pi harness to openai-codex/gpt-5.6-luna.",
    );
  }
  for (const role of PI_ROLES) {
    const entry = pi.roles?.[role];
    if (!entry) throw new Error(`P5 Pi harness is missing role '${role}'.`);
    if (role === "verifier" && entry.enabled === false) continue;
    if (
      entry.model !== "openai-codex/gpt-5.6-luna" ||
      typeof entry.thinking !== "string"
    ) {
      throw new Error(
        `P5 Pi role '${role}' must pin model openai-codex/gpt-5.6-luna and a thinking level.`,
      );
    }
  }
  if (pi.roles.verifier?.enabled !== false) {
    throw new Error(
      "P5 core-parity mode requires the Pi verifier role to be disabled (no external reviewer).",
    );
  }

  const codex = manifest.harnesses?.codex;
  if (
    !codex ||
    codex.model !== "gpt-5.6-luna" ||
    typeof codex.cliVersion !== "string" ||
    typeof codex.reasoningEffort !== "string" ||
    codex.sandbox !== "workspace-write" ||
    codex.approvalPolicy !== "never" ||
    codex.networkAccess !== false
  ) {
    throw new Error(
      "P5 manifest must pin the Codex harness to gpt-5.6-luna with an explicit, fair sandbox/approval/network configuration.",
    );
  }
  if (codex.reasoningEffort !== pi.thinking) {
    throw new Error(
      "P5 manifest must use the same reasoning effort label for both harnesses.",
    );
  }

  if (!Array.isArray(manifest.runs) || manifest.runs.length < 2) {
    throw new Error("P5 manifest must include at least the smoketest pair.");
  }
  const seenIds = new Set();
  for (const run of manifest.runs) {
    if (
      !/^p5-[a-z0-9-]+$/.test(run.id ?? "") ||
      run.stackMode !== "core-parity"
    ) {
      throw new Error(
        "P5 runs require path-safe ids and an explicit core-parity stack mode.",
      );
    }
    if (seenIds.has(run.id))
      throw new Error(`Duplicate P5 run id '${run.id}'.`);
    seenIds.add(run.id);
    if (run.harness !== "pi" && run.harness !== "codex") {
      throw new Error(`P5 run '${run.id}' must declare harness pi or codex.`);
    }
    if (
      !existsSync(
        join(root, "benchmarks", "v2", "tasks", run.task, "PROMPT.md"),
      )
    ) {
      throw new Error(
        `P5 public prompt missing for task '${run.task}' (run '${run.id}').`,
      );
    }
  }
  return true;
}
