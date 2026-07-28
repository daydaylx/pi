/**
 * Running the agent process and measuring it.
 *
 * stdout/stderr go to files rather than pipes so a long run cannot deadlock on
 * a full buffer, and GNU time supplies the wall/CPU/RSS record.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { agentInvocation } from "./agent.mjs";
import {
  GNU_TIME,
  LEDGER_GATE_ENV,
  PI_MODEL,
  PI_THINKING,
  benchmarkEnvironmentOverrides,
} from "./config.mjs";
import { fail } from "./io.mjs";
import { appendSystemPrompt } from "./prompts.mjs";

function parseWallSeconds(raw) {
  const value = raw.trim();
  const parts = value.split(":").map(Number);
  if (parts.some((part) => Number.isNaN(part))) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

function parseGnuTime(path) {
  if (!existsSync(path)) return null;
  const values = new Map();
  for (const line of readFileSync(path, "utf8").split("\n")) {
    // GNU time's wall-clock label itself contains `h:mm:ss`, so split at
    // the first colon followed by a space rather than the final colon.
    const separator = line.indexOf(": ");
    if (separator > 0)
      values.set(
        line.slice(0, separator).trim(),
        line.slice(separator + 2).trim(),
      );
  }
  const numeric = (label) => {
    const value = Number(values.get(label));
    return Number.isFinite(value) ? value : null;
  };
  return {
    cpuUserSeconds: numeric("User time (seconds)"),
    cpuSystemSeconds: numeric("System time (seconds)"),
    wallSeconds: parseWallSeconds(
      values.get("Elapsed (wall clock) time (h:mm:ss or m:ss)") ?? "",
    ),
    peakRssKiB: numeric("Maximum resident set size (kbytes)"),
  };
}

export function spawnToFiles(command, args, options) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, options);
    child.on("error", rejectPromise);
    child.on("close", (code, signal) =>
      resolvePromise({ code: code ?? 1, signal: signal ?? null }),
    );
  });
}

function launchEnvironment(run, paths) {
  const environment = {
    ...process.env,
    PI_CODING_AGENT_DIR: paths.worktree,
    PI_CODING_AGENT_SESSION_DIR: paths.runDir,
  };
  delete environment[LEDGER_GATE_ENV];
  return { ...environment, ...benchmarkEnvironmentOverrides(run) };
}

export async function runAgentSession(run, paths, prompts) {
  const timeFile = join(paths.runDir, "time-session.txt");
  const systemPrompt = appendSystemPrompt(run);
  const args = [
    "-v",
    "-o",
    timeFile,
    ...agentInvocation(run, paths),
    "--offline",
    "--approve",
    "--session",
    paths.session,
    "--session-dir",
    paths.runDir,
    "--name",
    run.id,
    "--model",
    PI_MODEL,
    "--thinking",
    PI_THINKING,
  ];
  if (run.task === "11-context-ledger-survival") args.push("--plan");
  if (systemPrompt) args.push("--append-system-prompt", systemPrompt);
  args.push("--print", ...prompts);
  // Do not retain Pi stdout/stderr: an agent may handle credentials through
  // its runtime, and P3 needs only the session plus GNU-time measurements.
  const processResult = await spawnToFiles(GNU_TIME, args, {
    cwd: paths.worktree,
    env: launchEnvironment(run, paths),
    stdio: "ignore",
  });
  const measurement = parseGnuTime(timeFile);
  if (!measurement)
    fail(`GNU time did not produce a resource record for ${run.id}.`);
  return {
    label: "session",
    exitCode: processResult.code,
    signal: processResult.signal,
    ...measurement,
  };
}

export function aggregateResources(launches) {
  const sum = (key) =>
    launches.reduce((total, launch) => total + (launch[key] ?? 0), 0);
  const peaks = launches
    .map((launch) => launch.peakRssKiB)
    .filter((value) => value !== null);
  return {
    launches,
    totalCpuUserSeconds: sum("cpuUserSeconds"),
    totalCpuSystemSeconds: sum("cpuSystemSeconds"),
    totalWallSeconds: sum("wallSeconds"),
    peakRssKiB: peaks.length > 0 ? Math.max(...peaks) : null,
  };
}
