import type { TUI } from "@earendil-works/pi-tui";
import type { InteractiveTerminal, PtySize } from "./runner.ts";

const CLEAR_SCREEN = "\u001b[2J\u001b[H";
const RESET_TERMINAL = "\u001b[0m\u001b[?25h";
const MAX_COMMAND_LABEL = 240;

function commandLabel(command: string): string {
  const oneLine = command.replace(/[\r\n]+/g, " ").trim();
  return oneLine.length <= MAX_COMMAND_LABEL
    ? oneLine
    : `${oneLine.slice(0, MAX_COMMAND_LABEL - 1)}…`;
}

/**
 * Bridges the process terminal to a PTY while Pi's TUI is stopped.
 *
 * stdin data is handled by this short-lived listener only. It is not sent
 * through the TUI input dispatcher, an extension event, a transcript, or a
 * logger. The listener stores no input and is removed before the TUI resumes.
 */
export function createProcessTerminal(
  tui: TUI,
  command: string,
): InteractiveTerminal {
  let inputHandler: ((data: Buffer | string) => void) | undefined;
  let resizeHandler: (() => void) | undefined;
  let entered = false;
  let rawModeChanged = false;

  const terminal = {
    getSize(): PtySize {
      return {
        columns: Math.max(1, tui.terminal.columns),
        rows: Math.max(1, tui.terminal.rows),
      };
    },

    enter(onInput: (data: string) => void, onResize: () => void): void {
      if (entered) return;
      entered = true;
      try {
        tui.stop();
        process.stdout.write(CLEAR_SCREEN);
        process.stdout.write(
          `INTERACTIVE TERMINAL\nAgent input paused\nCommand: ${commandLabel(command)}\nCtrl+C: interrupt process\n\n`,
        );

        inputHandler = (data) => onInput(data.toString());
        resizeHandler = onResize;
        if (
          process.stdin.isTTY &&
          typeof process.stdin.setRawMode === "function"
        ) {
          process.stdin.setRawMode(true);
          rawModeChanged = true;
        }
        process.stdin.resume();
        process.stdin.on("data", inputHandler);
        process.stdout.on("resize", resizeHandler);
      } catch (error) {
        if (inputHandler) process.stdin.removeListener("data", inputHandler);
        if (resizeHandler)
          process.stdout.removeListener("resize", resizeHandler);
        if (rawModeChanged && process.stdin.isTTY) {
          process.stdin.setRawMode(false);
        }
        inputHandler = undefined;
        resizeHandler = undefined;
        rawModeChanged = false;
        process.stdin.pause();
        try {
          tui.start();
          tui.requestRender(true);
        } catch {
          // Preserve the original setup error.
        }
        entered = false;
        throw error;
      }
    },

    write(data: string): void {
      process.stdout.write(data);
    },

    leave(): void {
      if (!entered) return;
      entered = false;
      if (inputHandler) process.stdin.removeListener("data", inputHandler);
      if (resizeHandler) process.stdout.removeListener("resize", resizeHandler);
      inputHandler = undefined;
      resizeHandler = undefined;
      if (rawModeChanged && process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      rawModeChanged = false;
      process.stdin.pause();
      process.stdout.write(`\n\n${RESET_TERMINAL}Interactive session ended\n`);
      tui.start();
      tui.requestRender(true);
    },
  } satisfies InteractiveTerminal;

  return terminal;
}
