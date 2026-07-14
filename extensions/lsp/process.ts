/**
 * Language-server child-process lifecycle.
 *
 * Responsibilities (issue #93):
 *   - Spawn with command and arguments kept strictly separate (never a shell
 *     string built from untrusted project values).
 *   - Capture stderr and surface coarse lifecycle events.
 *   - Detect a missing binary (ENOENT) without crashing the host.
 *   - Controlled restart with bounded exponential backoff; never an endless
 *     loop. Repeated crashes degrade instead of respawning forever.
 *   - Graceful stop: SIGTERM, grace window, then SIGKILL — and never leave an
 *     orphaned process behind.
 *
 * Restart here respawns the process and emits `ready` again with fresh
 * streams; the higher-level client (#93 `client.ts`) re-runs `initialize` on
 * each `ready` so capabilities are renegotiated. No `setInterval` is used.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import type { LspLogger } from "./types.ts";

export interface LspProcessOptions {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  /** Max automatic restarts after unexpected exits. Default 1. */
  maxRestarts?: number;
  /** Base backoff in ms; doubled per attempt. Default 100. */
  backoffBaseMs?: number;
  /** Backoff cap in ms. Default 5000. */
  backoffMaxMs?: number;
  /** Grace window between SIGTERM and SIGKILL on stop. Default 2000. */
  shutdownGraceMs?: number;
  logger?: LspLogger;
}

export interface ProcessExitInfo {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export interface DegradedInfo {
  cause: "missing_binary" | "spawn_error" | "repeated_crash";
  message: string;
}

/**
 * Emitted events:
 *  - `ready`: a fresh process is running and `stdin`/`stdout`/`stderr` are
 *    available (also emitted after a successful restart).
 *  - `stderr`: raw stderr chunk (for structured logging only).
 *  - `exit`: process exited with code/signal.
 *  - `restart`: an automatic restart was scheduled `{ attempt, delayMs }`.
 *  - `degraded`: no further automatic recovery; `{ cause, message }`.
 */
export class LspProcess extends EventEmitter {
  private child?: ChildProcess;
  private intentionalStop = false;
  private restartCount = 0;
  private exited = false;
  private restartTimer?: ReturnType<typeof setTimeout>;
  private readonly maxRestarts: number;
  private readonly backoffBaseMs: number;
  private readonly backoffMaxMs: number;
  private readonly shutdownGraceMs: number;
  private readonly logger: LspLogger;

  stdin!: ChildProcess["stdin"];
  stdout!: ChildProcess["stdout"];
  stderr!: ChildProcess["stderr"];

  constructor(private readonly options: LspProcessOptions) {
    super();
    this.maxRestarts = options.maxRestarts ?? 1;
    this.backoffBaseMs = options.backoffBaseMs ?? 100;
    this.backoffMaxMs = options.backoffMaxMs ?? 5_000;
    this.shutdownGraceMs = options.shutdownGraceMs ?? 2_000;
    this.logger = options.logger ?? (() => undefined);
  }

  /** Spawn the first instance. Emits `ready` (or `degraded`). */
  start(): void {
    this.intentionalStop = false;
    this.spawnOnce();
  }

  get pid(): number | undefined {
    return this.child?.pid;
  }

  /** True when a process is currently alive. */
  get running(): boolean {
    return (
      !this.exited &&
      this.child !== undefined &&
      this.child.pid !== undefined &&
      this.child.exitCode === null &&
      this.child.signalCode === null
    );
  }

  private spawnOnce(): void {
    const { command, args, cwd, env } = this.options;
    this.logger("info", `spawning language server: ${command} ${args.join(" ")}`);

    let child: ChildProcess;
    try {
      child = spawn(command, args, {
        stdio: ["pipe", "pipe", "pipe"],
        cwd,
        env: env ? { ...process.env, ...env } : undefined,
        windowsHide: true,
      });
    } catch (error) {
      // Synchronous spawn failures are rare (Node emits 'error' instead), but
      // we guard anyway so the host never crashes.
      this.emit("degraded", {
        cause: "spawn_error",
        message: `spawn threw: ${describeError(error)}`,
      } satisfies DegradedInfo);
      return;
    }

    this.child = child;
    this.exited = false;
    this.stdin = child.stdin;
    this.stdout = child.stdout;
    this.stderr = child.stderr;

    this.stderr?.on("data", (chunk: Buffer) => {
      this.emit("stderr", chunk);
    });

    // Attach 'error' sinks to every stdio stream so an EPIPE after exit (or a
    // missing-binary pipe) never surfaces as an unhandled stream error that
    // would crash the host. The transport handles logical write failures.
    for (const stream of [child.stdin, child.stdout, child.stderr]) {
      stream?.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT" && error.code !== "EPIPE") {
          this.logger("error", `stdio error: ${describeError(error)}`);
        }
      });
    }

    child.on("error", (error: NodeJS.ErrnoException) => {
      this.exited = true;
      if (error.code === "ENOENT") {
        this.intentionalStop = true;
        this.logger("error", `language server binary not found: ${command}`);
        this.emit("degraded", {
          cause: "missing_binary",
          message: `Binary '${command}' not found in PATH.`,
        } satisfies DegradedInfo);
      } else {
        this.logger("error", `process error: ${describeError(error)}`);
        this.emit("degraded", {
          cause: "spawn_error",
          message: describeError(error),
        } satisfies DegradedInfo);
      }
    });

    child.on("exit", (code, signal) => {
      this.exited = true;
      const info: ProcessExitInfo = { code, signal };
      this.emit("exit", info);
      if (this.intentionalStop) return;

      this.logger("error", `unexpected exit code=${code} signal=${signal}`);
      if (this.restartCount < this.maxRestarts) {
        this.restartCount += 1;
        const delayMs = Math.min(
          this.backoffMaxMs,
          this.backoffBaseMs * 2 ** (this.restartCount - 1),
        );
        this.emit("restart", { attempt: this.restartCount, delayMs });
        this.restartTimer = setTimeout(() => {
          this.restartTimer = undefined;
          if (this.intentionalStop) return;
          this.spawnOnce();
        }, delayMs);
      } else {
        this.emit("degraded", {
          cause: "repeated_crash",
          message: `stopped restarting after ${this.restartCount} attempt(s).`,
        } satisfies DegradedInfo);
      }
    });

    this.emit("ready");
  }

  /**
   * Stop the current process gracefully. Resolves once the process is gone or
   * has been force-killed. Safe to call multiple times and after exit.
   */
  async stop(): Promise<void> {
    this.intentionalStop = true;
    // Cancel any pending restart so stop() never leaves a deferred respawn.
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = undefined;
    }
    const child = this.child;
    if (!child || !this.running) return;

    const exited = waitForExit(child, this.shutdownGraceMs);
    try {
      child.kill("SIGTERM");
    } catch {
      /* process may have already exited */
    }
    await exited;

    if (this.running && child.pid !== undefined) {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }
  }
}

/** Resolve when `child` exits, or after `timeoutMs` regardless. */
function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      child.removeListener("exit", finish);
      resolve();
    };
    child.once("exit", finish);
    setTimeout(finish, timeoutMs);
  });
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
