/**
 * The Codex-CLI-side launchAgent implementation p5-controller.mjs's
 * runP5Task calls for `harness: "codex"` runs. Structural counterpart to
 * launch-pi.mjs / p4/launch.mjs, but for `codex exec` instead of `pi --print`.
 *
 * Design notes (see METHODOLOGY.md for the full rationale):
 *
 * - Each run gets its own isolated CODEX_HOME (`p5/io.mjs`'s
 *   `codexRunPaths().codexHome`), never the user's real `~/.codex`. Only
 *   `auth.json` is copied in — no sessions, no history, no config.toml (so
 *   there is no `model="gpt-5.6-terra"` default to fight; every setting we
 *   care about is passed explicitly via CLI flags/`-c` overrides instead).
 *   This also makes the run's own rollout file trivially findable: it is the
 *   only one under `<codexHome>/sessions/`.
 * - `--ephemeral` is deliberately NOT set — the rollout JSONL is the only
 *   source for `turn_context.model`/`reasoning_effort` and Codex's own
 *   token/tool-call accounting (collect-codex-metrics.mjs).
 * - `--output-schema` is deliberately NOT used in Core-Parity mode — it has
 *   no Pi equivalent and would constrain Codex's response shape unfairly.
 */
import { spawn } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { GLOBAL_CODEX_BIN } from "./config.mjs";
import { codexRunPaths, privateDir } from "./io.mjs";

function fail(message) {
  throw new Error(message);
}

export function isOfflineTest() {
  return process.env.P5_OFFLINE_TEST === "1";
}

function codexInvocation() {
  const override = process.env.P5_CODEX_BIN;
  if (!override) return GLOBAL_CODEX_BIN;
  if (!isOfflineTest()) {
    fail("P5_CODEX_BIN is reserved for the offline controller test.");
  }
  return override;
}

function spawnCapture(command, args, options) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, options);
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => (stdout += chunk));
    child.stderr?.on("data", (chunk) => (stderr += chunk));
    child.on("error", rejectPromise);
    child.on("close", (code, signal) =>
      resolvePromise({
        code: code ?? 1,
        signal: signal ?? null,
        stdout,
        stderr,
      }),
    );
  });
}

/** Only auth.json is copied — no sessions, no history, no config.toml. */
function seedIsolatedCodexHome(codexHome) {
  mkdirSync(codexHome, { recursive: true, mode: 0o700 });
  const sourceAuth = join(homedir(), ".codex", "auth.json");
  if (!existsSync(sourceAuth)) {
    fail(
      `Codex auth.json not found at ${sourceAuth} — run 'codex login' first.`,
    );
  }
  copyFileSync(sourceAuth, join(codexHome, "auth.json"));
}

function findRolloutFile(codexHome) {
  const sessionsRoot = join(codexHome, "sessions");
  if (!existsSync(sessionsRoot)) return null;
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (
        entry.isFile() &&
        entry.name.startsWith("rollout-") &&
        entry.name.endsWith(".jsonl")
      )
        found.push(full);
    }
  };
  walk(sessionsRoot);
  if (found.length === 0) return null;
  // An isolated CODEX_HOME should contain exactly one rollout for a
  // Core-Parity run (no subagent threads expected). If more than one
  // exists, prefer the top-level (non-subagent) thread and let the caller's
  // multi-agent detection surface the rest as a fairness confounder.
  return found.sort()[0];
}

function readJsonlTypedLine(rolloutPath, type) {
  const raw = readFileSync(rolloutPath, "utf8");
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry?.type === type) return entry.payload ?? entry;
  }
  return null;
}

function countRolloutFiles(codexHome) {
  const sessionsRoot = join(codexHome, "sessions");
  if (!existsSync(sessionsRoot)) return 0;
  let count = 0;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (
        entry.isFile() &&
        entry.name.startsWith("rollout-") &&
        entry.name.endsWith(".jsonl")
      )
        count += 1;
    }
  };
  walk(sessionsRoot);
  return count;
}

/**
 * @param {object} manifest the loaded, validated P5 manifest
 * @param {string} state the P5 CLI's private state root (io.mjs stateRoot())
 */
export function createLaunchCodexAgent({ manifest, state }) {
  return async function launchAgent({ worktree, prompt, env, run }) {
    const paths = codexRunPaths(state, run.id);
    privateDir(paths.runDir);
    seedIsolatedCodexHome(paths.codexHome);
    const codex = manifest.harnesses.codex;

    const args = [
      "exec",
      "--json",
      "--skip-git-repo-check",
      "-C",
      worktree,
      "-m",
      codex.model,
      "-c",
      `model=${codex.model}`,
      "-c",
      `model_reasoning_effort=${codex.reasoningEffort}`,
      "-s",
      codex.sandbox,
      // Note: `codex exec --help` (0.149.1) has no `-a/--ask-for-approval`
      // flag — that flag exists only on the interactive top-level `codex`
      // command. `exec` is inherently non-interactive: there is no TTY to
      // prompt, so the sandbox mode alone (`-s`) is the sole permission
      // gate. `manifest.harnesses.codex.approvalPolicy` is kept as a
      // documented-intent field (see ENVIRONMENT.md), not a literal flag.
      "-o",
      paths.outputLastMessage,
      prompt,
    ];

    const startedAt = Date.now();
    const result = await spawnCapture(codexInvocation(), args, {
      cwd: worktree,
      env: { ...env, CODEX_HOME: paths.codexHome },
      // `codex exec --help`: "If stdin is piped and a prompt is also
      // provided, stdin is appended as a <stdin> block" — it waits for EOF
      // on stdin regardless of the positional prompt argument. Node's
      // default spawn() stdio leaves stdin as an open, unclosed pipe, so
      // without this the process hangs indefinitely waiting for input that
      // never comes (observed: >80 minutes at 0% CPU before being killed).
      // `stdio[0]: "ignore"` gives it /dev/null (immediate EOF) instead.
      stdio: ["ignore", "pipe", "pipe"],
    });
    const durationMs = Date.now() - startedAt;

    const { writeFileSync } = await import("node:fs");
    writeFileSync(paths.jsonlLog, result.stdout);
    writeFileSync(paths.stderrLog, result.stderr);

    if (result.code !== 0) {
      throw new Error(
        `P5 Codex agent process for run '${run.id}' exited with code ${result.code}${
          result.signal ? ` (signal ${result.signal})` : ""
        }. See ${paths.stderrLog}.`,
      );
    }

    const rolloutPath = findRolloutFile(paths.codexHome);
    if (!rolloutPath) {
      throw new Error(
        `P5 Codex run '${run.id}' produced no rollout file under ${paths.codexHome}.`,
      );
    }
    const sessionMeta = readJsonlTypedLine(rolloutPath, "session_meta");
    const turnContext = readJsonlTypedLine(rolloutPath, "turn_context");
    const rolloutCount = countRolloutFiles(paths.codexHome);

    return {
      resolvedRoles: {
        main: {
          model: turnContext?.model ?? null,
          // Field name calibrated against a real rollout file (see
          // METHODOLOGY.md): turn_context's reasoning-effort key is
          // `effort`, not `reasoning_effort` as originally assumed from
          // secondhand research.
          thinking: turnContext?.effort ?? null,
          provider: "codex-cli",
        },
      },
      roleHistory: [],
      sessionMetrics: {
        durationMs,
        exitCode: result.code,
        jsonlEventLineCount: result.stdout
          .split("\n")
          .filter((line) => line.trim().length > 0).length,
        rolloutFileCount: rolloutCount,
        contextWindow: sessionMeta?.context_window ?? null,
        // multi_agent_version lives on turn_context, not session_meta
        // (calibrated against a real rollout file).
        multiAgentVersion: turnContext?.multi_agent_version ?? null,
      },
      sessionPath: rolloutPath,
    };
  };
}
