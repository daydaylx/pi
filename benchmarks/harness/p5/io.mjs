/**
 * Local P5 CLI state: a private results directory and per-run paths.
 * Deliberately independent from benchmarks/harness/p4/io.mjs — P4 is a
 * separately versioned series and P5 should not grow a dependency on it.
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
  const state = join(base, "pi-p5");
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

/** Per-run paths for the Pi harness side. */
export function piRunPaths(state, runId) {
  const runDir = join(state, "runs", runId, "pi");
  return {
    runDir,
    session: join(runDir, "session.jsonl"),
    result: join(runDir, "run-result.json"),
  };
}

/** Per-run paths for the Codex harness side, including its isolated CODEX_HOME. */
export function codexRunPaths(state, runId) {
  const runDir = join(state, "runs", runId, "codex");
  return {
    runDir,
    codexHome: join(runDir, "codex-home"),
    outputLastMessage: join(runDir, "last-message.txt"),
    jsonlLog: join(runDir, "events.jsonl"),
    stderrLog: join(runDir, "stderr.log"),
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
    fail("Refusing to operate outside the P5 state directory.");
  }
}
