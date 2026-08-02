/**
 * Private task and evaluator boundary for the V2 benchmark series.
 *
 * Private material is supplied at runtime rather than checked into this
 * repository. A benchmark agent receives only a public prompt and worktree;
 * the evaluator receives the completed worktree afterwards.
 */
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { isAbsolute, join, relative, resolve } from "node:path";

const ROOT_VARIABLE = "PI_BENCHMARK_PRIVATE_ROOT";
const TASK_ID = /^(?:0[1-9]|[1-9][0-9]*)-[a-z0-9-]+$/;
const SAFE_RESULT_KEYS = new Set([
  "status",
  "correctness",
  "antiGaming",
  "summary",
  "evaluatorFingerprint",
  "inputFingerprint",
  "durationMs",
]);

export function privateRoot(env = process.env) {
  const configured = env[ROOT_VARIABLE];
  if (typeof configured !== "string" || configured.length === 0) {
    throw new Error(`${ROOT_VARIABLE} must name the external private evaluator root.`);
  }
  if (!isAbsolute(configured)) {
    throw new Error(`${ROOT_VARIABLE} must be an absolute path.`);
  }
  const root = resolve(configured);
  if (!existsSync(root) || !lstatSync(root).isDirectory()) {
    throw new Error(`${ROOT_VARIABLE} must name an existing directory.`);
  }
  return root;
}

export function privateTaskPath(root, taskId) {
  if (typeof taskId !== "string" || !TASK_ID.test(taskId)) {
    throw new Error("Private benchmark task id is invalid.");
  }
  const task = resolve(root, "tasks", taskId);
  const containment = relative(root, task);
  if (containment.startsWith("..") || isAbsolute(containment)) {
    throw new Error("Private benchmark task path escapes its evaluator root.");
  }
  return task;
}

export function loadPrivateTask(root, taskId) {
  const task = privateTaskPath(root, taskId);
  const metadataPath = join(task, "metadata.json");
  const evaluatorPath = join(task, "evaluator.mjs");
  if (!existsSync(metadataPath) || !existsSync(evaluatorPath)) {
    throw new Error("Private benchmark task is incomplete (metadata.json and evaluator.mjs are required).");
  }
  let metadata;
  try {
    metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
  } catch {
    throw new Error("Private benchmark task metadata is not valid JSON.");
  }
  if (!metadata || typeof metadata !== "object" || metadata.taskId !== taskId) {
    throw new Error("Private benchmark task metadata does not match the requested task.");
  }
  return { task, metadataPath, evaluatorPath, metadata };
}

/** Do not pass private-root discovery or controller-only switches to Pi. */
export function agentEnvironment(env = process.env) {
  const result = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== "string") continue;
    if (key === ROOT_VARIABLE || key.startsWith("P3_") || key.startsWith("PI_BENCHMARK_")) continue;
    result[key] = value;
  }
  return result;
}

function redactedText(value, root) {
  return String(value)
    .replaceAll(root, "[private evaluator]")
    .replace(/(?:reference|solution|hidden[ -]?test)[^\n]{0,180}/gi, "[redacted evaluator detail]");
}

export function publicEvaluatorResult(value, root) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Private evaluator did not return a JSON object.");
  }
  const result = {};
  for (const [key, candidate] of Object.entries(value)) {
    if (!SAFE_RESULT_KEYS.has(key)) continue;
    result[key] = typeof candidate === "string" ? redactedText(candidate, root) : candidate;
  }
  if (typeof result.status !== "string") {
    throw new Error("Private evaluator result has no status.");
  }
  return result;
}

export function runPrivateEvaluator({ root, taskId, worktree, timeoutMs = 300_000 }) {
  const task = loadPrivateTask(root, taskId);
  const result = spawnSync(process.execPath, [task.evaluatorPath, "--worktree", resolve(worktree)], {
    cwd: task.task,
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", TMPDIR: process.env.TMPDIR ?? "" },
    timeout: timeoutMs,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Private evaluator failed: ${redactedText(result.stderr || result.error?.message || "unknown error", root)}`);
  }
  return publicEvaluatorResult(JSON.parse(result.stdout), root);
}
