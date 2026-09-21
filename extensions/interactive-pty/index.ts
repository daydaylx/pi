import { createRequire } from "node:module";
import { Type } from "typebox";
import type {
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
  runInteractivePty,
  type InteractivePtyResult,
  type PtyProcess,
} from "./runner.ts";
import { forbiddenInteractiveCredentialPath } from "../shared/interactive-shell-policy.ts";
import { createProcessTerminal } from "./terminal.ts";

const require = createRequire(import.meta.url);
const { spawn } =
  require("../../npm/node_modules/node-pty") as typeof import("node-pty");

const interactiveShellSchema = Type.Object({
  command: Type.String({ description: "Shell command to run interactively" }),
  timeout: Type.Optional(
    Type.Number({ description: "Timeout in seconds (optional)" }),
  ),
});

const MAX_TIMEOUT_SECONDS = 2_147_483;

function resultText(result: InteractivePtyResult): string {
  if (result.timedOut) {
    return `Interactive command timed out${
      result.exitCode === null ? "" : ` with exit code ${result.exitCode}`
    }.`;
  }
  if (result.aborted) return "Interactive command aborted.";
  return `Interactive command exited with code ${result.exitCode ?? "unknown"}.`;
}

function statusResult(result: InteractivePtyResult) {
  return {
    content: [{ type: "text" as const, text: resultText(result) }],
    details: {
      exitCode: result.exitCode,
      killed: result.killed,
      aborted: result.aborted,
      timedOut: result.timedOut,
    },
  };
}

function unavailableResult(text: string) {
  return {
    content: [{ type: "text" as const, text }],
    details: { blocked: true },
  };
}

function createPty(
  file: string,
  args: string[],
  options: {
    name: string;
    cols: number;
    rows: number;
    cwd: string;
    env: NodeJS.ProcessEnv;
  },
): PtyProcess {
  return spawn(file, args, {
    name: options.name,
    cols: options.cols,
    rows: options.rows,
    cwd: options.cwd,
    env: options.env,
  });
}

function shellEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  // Pi never accepts or creates password environment variables. Removing this
  // common accidental shortcut also prevents inherited state from becoming a
  // hidden password channel for the interactive tool.
  delete env.SUDO_PASSWORD;
  return env;
}

function interactiveTool(): ToolDefinition<typeof interactiveShellSchema> {
  return {
    name: "interactive_shell",
    label: "interactive shell",
    description:
      "Run a command in a real interactive terminal. Use this for sudo, ssh, editors, and other commands that need direct user input. The user types directly into the terminal; never pass passwords or other secrets as tool arguments.",
    promptSnippet: "Run commands requiring direct user terminal input",
    promptGuidelines: [
      "Use interactive_shell instead of bash when a command needs a TTY or direct user input.",
      "Never ask for, include, or replay passwords or credentials in tool arguments or results.",
    ],
    parameters: interactiveShellSchema,
    executionMode: "sequential",
    async execute(
      _toolCallId,
      params,
      signal,
      _onUpdate,
      ctx: ExtensionContext,
    ) {
      if (ctx.mode !== "tui" || !ctx.hasUI) {
        return unavailableResult(
          "Interactive terminal requires the TUI; no process was started.",
        );
      }
      if (!process.stdin.isTTY || !process.stdout.isTTY) {
        return unavailableResult(
          "Interactive terminal requires a real TTY; no process was started.",
        );
      }
      if (!params.command.trim()) {
        return unavailableResult("Interactive command must not be empty.");
      }
      const forbidden = forbiddenInteractiveCredentialPath(params.command);
      if (forbidden) return unavailableResult(forbidden);
      if (
        params.timeout !== undefined &&
        (!Number.isFinite(params.timeout) ||
          params.timeout <= 0 ||
          params.timeout > MAX_TIMEOUT_SECONDS)
      ) {
        return unavailableResult("Invalid interactive timeout.");
      }

      const shell = process.env.SHELL || "/bin/sh";
      const timeoutMs =
        params.timeout === undefined ? undefined : params.timeout * 1000;
      let result: InteractivePtyResult;

      try {
        result = await ctx.ui.custom<InteractivePtyResult>(
          (tui, _theme, _keybindings, done) => {
            const terminal = createProcessTerminal(tui, params.command);
            void runInteractivePty({
              file: shell,
              args: ["-c", params.command],
              cwd: ctx.cwd,
              env: shellEnvironment(),
              terminal,
              spawn: createPty,
              signal,
              timeoutMs,
            })
              .then((completed) => done(completed))
              .catch(() =>
                done({
                  exitCode: null,
                  killed: true,
                  aborted: Boolean(signal?.aborted),
                  timedOut: false,
                }),
              );

            return {
              render: () => [],
              invalidate: () => {},
            };
          },
        );
      } catch {
        return unavailableResult(
          "Interactive terminal failed before the process result was available.",
        );
      }

      return statusResult(result);
    },
  };
}

export default function (pi: ExtensionAPI): void {
  pi.registerTool(interactiveTool());
}

export {
  forbiddenInteractiveCredentialPath,
  interactiveShellSchema,
  interactiveTool,
  resultText,
  shellEnvironment,
};
