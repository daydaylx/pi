/**
 * The real launchAgent implementation p4-controller.mjs's runP4Task calls.
 *
 * Spawns the actual Pi runtime against the prepared worktree in --print
 * (non-interactive) mode, then reads back which model each active subagent
 * role actually ran with. See subagent-artifacts.mjs for what is and is not
 * independently verifiable from that readback.
 */
import { spawn } from "node:child_process";
import { agentInvocation } from "./agent.mjs";
import { privateDir, runPaths } from "./io.mjs";
import { readSubagentRoleResults } from "./subagent-artifacts.mjs";

function spawnToExit(command, args, options) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, options);
    child.on("error", rejectPromise);
    child.on("close", (code, signal) =>
      resolvePromise({ code: code ?? 1, signal: signal ?? null }),
    );
  });
}

/**
 * @param {object} manifest the loaded, validated P4 manifest
 * @param {string} state the P4 CLI's private state root (io.mjs stateRoot())
 */
export function createLaunchAgent({ manifest, state }) {
  return async function launchAgent({ worktree, prompt, env, run }) {
    const paths = runPaths(state, run.id);
    privateDir(paths.runDir);
    const main = manifest.roles.main;
    const [command, ...leadingArgs] = agentInvocation();
    const args = [
      ...leadingArgs,
      "--offline",
      "--approve",
      "--session",
      paths.session,
      "--session-dir",
      paths.runDir,
      "--name",
      run.id,
      "--model",
      main.model,
      "--thinking",
      main.thinking,
      "--print",
      prompt,
    ];
    const startedAt = Date.now();
    const result = await spawnToExit(command, args, {
      cwd: worktree,
      env,
      stdio: "ignore",
    });
    const durationMs = Date.now() - startedAt;
    if (result.code !== 0) {
      throw new Error(
        `P4 agent process for run '${run.id}' exited with code ${result.code}${
          result.signal ? ` (signal ${result.signal})` : ""
        }.`,
      );
    }
    const otherActiveRoles = Object.entries(manifest.roles)
      .filter(([role, pin]) => role !== "main" && pin.enabled !== false)
      .map(([role]) => role);
    const { resolvedRoles: subagentRoles, roleHistory } =
      readSubagentRoleResults(
        paths.runDir,
        run.id,
        otherActiveRoles,
        main.thinking,
      );
    return {
      resolvedRoles: {
        main: { model: main.model, thinking: main.thinking },
        ...subagentRoles,
      },
      roleHistory,
      sessionMetrics: { durationMs, exitCode: result.code },
      sessionPath: paths.session,
    };
  };
}
