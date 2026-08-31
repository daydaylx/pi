/**
 * The Pi-side launchAgent implementation p5-controller.mjs's runP5Task calls
 * for `harness: "pi"` runs.
 *
 * Structurally mirrors benchmarks/harness/p4/launch.mjs, adapted to P5's
 * manifest shape (`manifest.harnesses.pi.roles` instead of `manifest.roles`)
 * and P5's own private state (p5/io.mjs, p5/agent.mjs) so P5 never depends
 * on P4's CLI internals.
 */
import { spawn } from "node:child_process";
import { agentInvocation } from "./agent.mjs";
import { piRunPaths, privateDir } from "./io.mjs";
import { readSubagentRoleResults } from "../p4/subagent-artifacts.mjs";

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
 * @param {object} manifest the loaded, validated P5 manifest
 * @param {string} state the P5 CLI's private state root (io.mjs stateRoot())
 */
export function createLaunchPiAgent({ manifest, state }) {
  return async function launchAgent({ worktree, prompt, env, run }) {
    const paths = piRunPaths(state, run.id);
    privateDir(paths.runDir);
    const main = manifest.harnesses.pi.roles.main;
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
        `P5 Pi agent process for run '${run.id}' exited with code ${result.code}${
          result.signal ? ` (signal ${result.signal})` : ""
        }.`,
      );
    }
    const otherActiveRoles = Object.entries(manifest.harnesses.pi.roles)
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
        main: {
          model: main.model,
          thinking: main.thinking,
          provider: manifest.harnesses.pi.provider,
        },
        ...subagentRoles,
      },
      roleHistory,
      sessionMetrics: { durationMs, exitCode: result.code },
      sessionPath: paths.session,
    };
  };
}
