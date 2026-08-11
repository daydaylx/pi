/**
 * Process execution with a real process-group kill on timeout/abort.
 *
 * Pi's extension executor only signals the direct child. This wrapper gives
 * POSIX commands their own process group so a timeout also reaches descendants
 * such as `npm`-spawned Node workers. It deliberately keeps the direct-child
 * exit, stream draining, and process-group escalation as separate lifecycles.
 */
import { spawn } from "node:child_process";

export interface TrackedExecOptions {
  cwd?: string;
  /** Hard timeout in milliseconds. */
  timeout?: number;
  /** Full environment for the child. Omit to inherit `process.env`. */
  env?: Record<string, string>;
  signal?: AbortSignal;
  /** Test seam; production callers use the default. */
  killGraceMs?: number;
}

export interface TrackedExecResult {
  stdout: string;
  stderr: string;
  code: number | null;
  killed: boolean;
  /** Which channel triggered the kill, if any. */
  killReason?: "timeout" | "abort-signal";
}

const KILL_GRACE_MS = 5_000;
const EXIT_STDIO_GRACE_MS = 100;

export function trackedExec(
  program: string,
  args: string[],
  options: TrackedExecOptions = {},
): Promise<TrackedExecResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(program, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let killed = false;
    let killReason: TrackedExecResult["killReason"];
    let exited = false;
    let settled = false;
    let exitCode: number | null = null;
    let stdoutEnded = child.stdout === null;
    let stderrEnded = child.stderr === null;
    let terminationEscalationPending = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let killGraceId: ReturnType<typeof setTimeout> | undefined;
    let postExitId: ReturnType<typeof setTimeout> | undefined;

    const clearTimer = (timer: ReturnType<typeof setTimeout> | undefined) => {
      if (timer) clearTimeout(timer);
    };

    const killGroup = (signal: "SIGTERM" | "SIGKILL") => {
      const pid = child.pid;
      if (!pid) return;
      if (process.platform === "win32") {
        if (signal === "SIGTERM") {
          try {
            spawn("taskkill", ["/F", "/T", "/PID", String(pid)], {
              stdio: "ignore",
              windowsHide: true,
            });
          } catch {
            // Best effort; a later process exit still finalizes the result.
          }
        }
        return;
      }
      try {
        process.kill(-pid, signal);
      } catch {
        try {
          process.kill(pid, signal);
        } catch {
          // Process group already exited.
        }
      }
    };

    const cleanup = () => {
      clearTimer(timeoutId);
      clearTimer(killGraceId);
      clearTimer(postExitId);
      timeoutId = undefined;
      killGraceId = undefined;
      postExitId = undefined;
      options.signal?.removeEventListener("abort", onAbort);
      child.removeListener("error", onError);
      child.removeListener("exit", onExit);
      child.removeListener("close", onClose);
      child.stdout?.removeListener("data", onStdoutData);
      child.stderr?.removeListener("data", onStderrData);
      child.stdout?.removeListener("end", onStdoutEnd);
      child.stderr?.removeListener("end", onStderrEnd);
    };

    const finalize = () => {
      if (settled) return;
      settled = true;
      cleanup();
      child.stdout?.destroy();
      child.stderr?.destroy();
      resolvePromise({
        stdout,
        stderr,
        code: exitCode,
        killed,
        ...(killReason ? { killReason } : {}),
      });
    };

    const armPostExitTimer = () => {
      if (!exited || settled || terminationEscalationPending) return;
      clearTimer(postExitId);
      postExitId = setTimeout(finalize, EXIT_STDIO_GRACE_MS);
    };

    const maybeFinalizeAfterExit = () => {
      if (settled || !exited || terminationEscalationPending) return;
      if (stdoutEnded && stderrEnded) finalize();
      else armPostExitTimer();
    };

    const onStdoutData = (data: Buffer) => {
      stdout += data.toString();
      armPostExitTimer();
    };
    const onStderrData = (data: Buffer) => {
      stderr += data.toString();
      armPostExitTimer();
    };
    const onStdoutEnd = () => {
      stdoutEnded = true;
      maybeFinalizeAfterExit();
    };
    const onStderrEnd = () => {
      stderrEnded = true;
      maybeFinalizeAfterExit();
    };
    const onError = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onExit = (code: number | null) => {
      exited = true;
      exitCode = code;
      maybeFinalizeAfterExit();
    };
    const onClose = (code: number | null) => {
      if (!exited) {
        exited = true;
        exitCode = code;
      }
      maybeFinalizeAfterExit();
    };

    const killProcess = (reason: "timeout" | "abort-signal") => {
      if (killed || settled) return;
      killed = true;
      killReason = reason;
      killGroup("SIGTERM");
      if (process.platform === "win32") return;
      terminationEscalationPending = true;
      killGraceId = setTimeout(() => {
        killGraceId = undefined;
        terminationEscalationPending = false;
        killGroup("SIGKILL");
        // A descendant may have inherited stdio. Give its final output a short
        // drain period after the hard process-group kill before resolving.
        armPostExitTimer();
        maybeFinalizeAfterExit();
      }, options.killGraceMs ?? KILL_GRACE_MS);
    };

    const onAbort = () => killProcess("abort-signal");
    if (options.signal) {
      if (options.signal.aborted) onAbort();
      else options.signal.addEventListener("abort", onAbort, { once: true });
    }
    if (options.timeout && options.timeout > 0) {
      timeoutId = setTimeout(() => killProcess("timeout"), options.timeout);
    }

    child.stdout?.on("data", onStdoutData);
    child.stderr?.on("data", onStderrData);
    child.stdout?.once("end", onStdoutEnd);
    child.stderr?.once("end", onStderrEnd);
    child.once("error", onError);
    child.once("exit", onExit);
    child.once("close", onClose);
  });
}
