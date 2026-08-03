/**
 * Local P4 CLI state: a private results directory and per-run session paths.
 *
 * Deliberately independent from benchmarks/harness/p3/io.mjs — P3 is a
 * retired series kept only for its manifest history, and P4 should not grow
 * a dependency on code that may be removed.
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

export function fail(message) {
  throw new Error(message);
}

export function stateRoot() {
  const base = process.env.XDG_STATE_HOME
    ? resolve(process.env.XDG_STATE_HOME)
    : join(homedir(), ".local", "state");
  const state = join(base, "pi-p4");
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

export function runPaths(state, runId) {
  const runDir = join(state, "runs", runId);
  return {
    runDir,
    session: join(runDir, "session.jsonl"),
    result: join(runDir, "run-result.json"),
    timeFile: join(runDir, "time-session.txt"),
  };
}

export function assertSafeStatePath(state, candidate) {
  const relativePath = relative(state, candidate);
  if (
    relativePath === "" ||
    relativePath.startsWith("..") ||
    isAbsolute(relativePath)
  ) {
    fail("Refusing to operate outside the P4 state directory.");
  }
}
