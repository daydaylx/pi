export interface PtySubscription {
  dispose(): void;
}

export interface PtyExitEvent {
  exitCode: number;
  signal?: number;
}

export interface PtyProcess {
  readonly pid?: number;
  onData(handler: (data: string) => void): PtySubscription;
  onExit(handler: (event: PtyExitEvent) => void): PtySubscription;
  write(data: string): void;
  resize(columns: number, rows: number): void;
  kill(signal?: string): void;
}

export interface PtySize {
  columns: number;
  rows: number;
}

export interface InteractiveTerminal {
  getSize(): PtySize;
  enter(onInput: (data: string) => void, onResize: () => void): void;
  write(data: string): void;
  leave(): void;
}

export interface InteractivePtyOptions {
  file: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  terminal: InteractiveTerminal;
  spawn: (
    file: string,
    args: string[],
    options: {
      name: string;
      cols: number;
      rows: number;
      cwd: string;
      env: NodeJS.ProcessEnv;
    },
  ) => PtyProcess;
  signal?: AbortSignal;
  timeoutMs?: number;
  killGraceMs?: number;
  killProcessGroup?: (pid: number, signal: "SIGTERM" | "SIGKILL") => void;
}

export interface InteractivePtyResult {
  exitCode: number | null;
  signal?: number;
  killed: boolean;
  aborted: boolean;
  timedOut: boolean;
}

const DEFAULT_KILL_GRACE_MS = 2_000;

function killProcessGroup(pid: number, signal: "SIGTERM" | "SIGKILL"): void {
  if (process.platform === "win32") return;
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // The process group may already have exited.
    }
  }
}

function dispose(subscription: PtySubscription | undefined): void {
  try {
    subscription?.dispose();
  } catch {
    // Cleanup is best effort and must not mask the process result.
  }
}

/**
 * Run one command through a PTY without retaining or returning PTY data.
 *
 * The terminal adapter is deliberately the only output sink. Input is passed
 * directly to the PTY and never enters an update callback, result object, or
 * session entry. This keeps the runner useful for sudo, ssh, editors, and
 * other interactive programs without creating a password-specific path.
 */
export function runInteractivePty(
  options: InteractivePtyOptions,
): Promise<InteractivePtyResult> {
  return new Promise((resolve, reject) => {
    const size = options.terminal.getSize();
    let pty: PtyProcess | undefined;
    let dataSubscription: PtySubscription | undefined;
    let exitSubscription: PtySubscription | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let killGraceId: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    let cleaned = false;
    let killed = false;
    let aborted = false;
    let timedOut = false;
    let exitCode: number | null = null;
    let exitSignal: number | undefined;
    let terminalEntered = false;
    let abortHandler: (() => void) | undefined;

    const cleanup = (): void => {
      if (cleaned) return;
      cleaned = true;
      if (timeoutId) clearTimeout(timeoutId);
      if (killGraceId) clearTimeout(killGraceId);
      if (abortHandler && options.signal) {
        options.signal.removeEventListener("abort", abortHandler);
      }
      dispose(dataSubscription);
      dispose(exitSubscription);
      if (terminalEntered) {
        try {
          options.terminal.leave();
        } catch {
          // Terminal restoration must not replace the process result.
        }
      }
    };

    const settle = (result: InteractivePtyResult): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    const sendKill = (signal: "SIGTERM" | "SIGKILL"): void => {
      if (!pty) return;
      if (pty.pid && options.killProcessGroup) {
        options.killProcessGroup(pty.pid, signal);
      } else if (pty.pid && process.platform !== "win32") {
        killProcessGroup(pty.pid, signal);
      }
      try {
        pty.kill(signal);
      } catch {
        // The PTY may have exited between the group and direct kill.
      }
    };

    const requestKill = (reason: "abort" | "timeout"): void => {
      if (settled || killed) return;
      killed = true;
      aborted = reason === "abort";
      timedOut = reason === "timeout";
      sendKill("SIGTERM");
      killGraceId = setTimeout(() => {
        killGraceId = undefined;
        sendKill("SIGKILL");
      }, options.killGraceMs ?? DEFAULT_KILL_GRACE_MS);
    };

    const onInput = (data: string): void => {
      if (settled || !pty) return;
      try {
        pty.write(data);
      } catch {
        requestKill("abort");
      }
    };

    const onResize = (): void => {
      if (settled || !pty) return;
      const next = options.terminal.getSize();
      if (next.columns < 1 || next.rows < 1) return;
      try {
        pty.resize(next.columns, next.rows);
      } catch {
        requestKill("abort");
      }
    };

    try {
      if (options.signal?.aborted) {
        settle({
          exitCode: null,
          killed: false,
          aborted: true,
          timedOut: false,
        });
        return;
      }

      options.terminal.enter(onInput, onResize);
      terminalEntered = true;
      pty = options.spawn(options.file, options.args, {
        name: "xterm-256color",
        cols: Math.max(1, size.columns),
        rows: Math.max(1, size.rows),
        cwd: options.cwd,
        env: options.env,
      });
      dataSubscription = pty.onData((data) => {
        if (settled) return;
        try {
          options.terminal.write(data);
        } catch {
          requestKill("abort");
        }
      });
      exitSubscription = pty.onExit((event) => {
        exitCode = event.exitCode;
        exitSignal = event.signal;
        settle({
          exitCode,
          ...(exitSignal === undefined ? {} : { signal: exitSignal }),
          killed,
          aborted,
          timedOut,
        });
      });

      onResize();

      if (options.signal) {
        abortHandler = () => requestKill("abort");
        options.signal.addEventListener("abort", abortHandler, { once: true });
      }
      if (options.timeoutMs !== undefined && options.timeoutMs > 0) {
        timeoutId = setTimeout(() => requestKill("timeout"), options.timeoutMs);
      }
    } catch (error) {
      if (pty && !settled) sendKill("SIGTERM");
      fail(new Error("Interactive process could not be started."));
    }
  });
}
