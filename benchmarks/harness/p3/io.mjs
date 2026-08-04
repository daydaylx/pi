/**
 * Private state directory, JSON handling and git.
 *
 * All mutable material lives outside the source checkout under a 0700 state
 * root, and every path derived from a run id is checked for containment before
 * it is written to.
 */
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { SOURCE_ROOT } from "./config.mjs";

export function fail(message) {
  throw new Error(message);
}

export function stateRoot() {
  const base = process.env.XDG_STATE_HOME
    ? resolve(process.env.XDG_STATE_HOME)
    : join(homedir(), ".local", "state");
  const state = join(base, "pi-p3");
  mkdirSync(state, { recursive: true, mode: 0o700 });
  chmodSync(state, 0o700);
  return state;
}

export function privateDir(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
  return path;
}

export function writePrivateJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  chmodSync(path, 0o600);
}

export function readJson(path, description) {
  if (!existsSync(path)) fail(`${description} is missing.`);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    fail(`${description} is not valid JSON.`);
  }
}

export function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function runGit(args, { cwd = SOURCE_ROOT, allowFailure = false } = {}) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) {
    if (allowFailure) return null;
    fail(`Git command failed: git ${args.join(" ")}`);
  }
  return result.stdout.trim();
}

export function runPaths(state, run) {
  const runDir = join(state, "runs", run.id);
  return {
    runDir,
    worktree: join(state, "worktrees", run.id),
    meta: join(runDir, "run.json"),
    session: join(runDir, "session.jsonl"),
    environment: join(runDir, "automatic-environment.json"),
    resources: join(runDir, "automatic-resources.json"),
    result: join(runDir, "run-result.json"),
  };
}

export function assertSafeStatePath(state, candidate) {
  const relativePath = relative(state, candidate);
  if (
    relativePath === "" ||
    relativePath.startsWith("..") ||
    isAbsolute(relativePath)
  ) {
    fail("Refusing to operate outside the P3 state directory.");
  }
}
