/**
 * Server registry keyed by `(workspaceRoot, serverId)`.
 *
 * Every server instance is lazily created on the first `acquire()` and reused
 * for subsequent requests.  Idle shutdown is handled via a one-shot
 * `setTimeout` that is re-armed only when no request is in flight — no
 * `setInterval` is ever used (guard-compliant).
 *
 * Issue #94 — configuration, root detection and registry.
 */

import { LspError } from "./types.ts";
import type { LspConfig, LspLogger, ServerProfile } from "./types.ts";
import { LspClient, formatErrorMessage } from "./client.ts";
import type { LspClientOptions, LspClientState } from "./client.ts";

interface RegistryEntry {
  client: LspClient;
  profile: ServerProfile;
  activeRequests: number;
  lastActivity: number;
  idleTimer?: ReturnType<typeof setTimeout>;
  pendingAcquire?: Promise<{ client: LspClient }>;
}

const KEY_SEPARATOR = "\0";

function makeKey(workspaceRoot: string, serverId: string): string {
  return `${workspaceRoot}${KEY_SEPARATOR}${serverId}`;
}

export interface RegistryOptions {
  config: LspConfig;
  logger?: LspLogger;
  /** Called whenever any client's state changes, so callers can update UI. */
  onStatusChange?: () => void;
}

export class ServerRegistry {
  private readonly entries = new Map<string, RegistryEntry>();
  private readonly config: LspConfig;
  private readonly logger: LspLogger;
  private readonly onStatusChange: (() => void) | undefined;

  constructor(options: RegistryOptions) {
    this.config = options.config;
    this.logger = options.logger ?? (() => undefined);
    this.onStatusChange = options.onStatusChange;
  }

  /** Number of tracked entries (for status/debug). */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Acquire an existing healthy client for `(root, serverId)` or create and
   * start a new one.  The caller **must** call {@link release} exactly once
   * when the client is no longer needed so the idle timer can be activated.
   */
  async acquire(
    workspaceRoot: string,
    profile: ServerProfile,
  ): Promise<{ client: LspClient }> {
    const key = makeKey(workspaceRoot, profile.id);
    const existing = this.entries.get(key);

    if (existing) {
      const state = existing.client.currentState;
      if (state === "ready") {
        existing.activeRequests += 1;
        existing.lastActivity = Date.now();
        this.clearIdle(existing);
        return { client: existing.client };
      }
      if (state === "degraded") {
        // Hand out a structured error so callers can surface the cause.
        throw new LspError({
          kind: "request_failed",
          serverId: profile.id,
          workspaceRoot,
          cause: `Server befindet sich im eingeschränkten Zustand`,
          remediation:
            "Server mit /lsp restart neu starten oder auf automatische Wiederherstellung warten.",
        });
      }
      // P1.1: Single-flight for "starting", "restarting", or "shutdown" states.
      // Share the in-flight start promise, but MUST increment activeRequests so
      // the server isn't shut down while the second caller still uses it.
      if (existing.pendingAcquire) {
        existing.activeRequests += 1;
        existing.lastActivity = Date.now();
        this.clearIdle(existing);
        return existing.pendingAcquire;
      }
      // When the client is starting or restarting but has no pendingAcquire
      // (e.g. a process-triggered restart, not an acquire()-initiated one),
      // create a fresh pendingAcquire that waits for the client to reach
      // ready or degraded. This prevents a second parallel client from being
      // spawned while the first one is still recovering.
      if (state === "starting" || state === "restarting") {
        existing.activeRequests += 1;
        existing.lastActivity = Date.now();
        this.clearIdle(existing);
        existing.pendingAcquire = new Promise<{ client: LspClient }>(
          (resolve, reject) => {
            const onState = (newState: LspClientState) => {
              if (newState === "ready") {
                cleanup();
                resolve({ client: existing.client });
              } else if (
                newState === "degraded" ||
                newState === "shutdown"
              ) {
                cleanup();
                reject(
                  new LspError({
                    kind: "request_failed",
                    serverId: profile.id,
                    workspaceRoot,
                    cause: `Server entered ${newState} during restart`,
                    remediation:
                      "Server mit /lsp restart neu starten oder auf automatische Wiederherstellung warten.",
                  }),
                );
              }
            };
            const cleanup = () => {
              existing.client.removeListener("state", onState);
              delete existing.pendingAcquire;
            };
            existing.client.on("state", onState);
          },
        );
        return existing.pendingAcquire;
      }
    }

    // Create new client, start it, and store the entry.
    const client = this.createClient(workspaceRoot, profile);
    const entry: RegistryEntry = {
      client,
      profile,
      activeRequests: 1,
      lastActivity: Date.now(),
    };
    // P1.1: Store the pending promise before starting to prevent races.
    entry.pendingAcquire = (async () => {
      try {
        await client.start();
        this.logger(
          "info",
          `started ${profile.id} at ${workspaceRoot} (pid ${client.pid})`,
        );
        return { client };
      } catch (error) {
        // Clean up entry on initial start failure. This is distinct from a
        // process crash after the server was ready — that path goes through
        // LspClient.onDegraded() and keeps the entry so the status shows
        // "eingeschränkt" instead of "leerlauf".
        this.entries.delete(key);
        await entry.client.shutdown().catch(() => undefined);
        if (error instanceof LspError) throw error;
        throw new LspError({
          kind: "spawn_error",
          serverId: profile.id,
          workspaceRoot,
          cause: formatErrorMessage(error),
          remediation:
            "Prüfen, ob die Server-Binärdatei installiert und in PATH ist.",
        });
      } finally {
        // Clear pending status after completion
        delete entry.pendingAcquire;
      }
    })();
    this.entries.set(key, entry);

    return entry.pendingAcquire;
  }

  /**
   * Decrement the active-request counter and arm the idle timer when it
   * reaches zero.  Safe to call multiple times — subsequent calls are no-ops
   * once the counter is already zero.
   */
  release(workspaceRoot: string, serverId: string): void {
    const key = makeKey(workspaceRoot, serverId);
    const entry = this.entries.get(key);
    if (!entry) return;

    if (entry.activeRequests > 0) entry.activeRequests -= 1;
    entry.lastActivity = Date.now();

    if (entry.activeRequests === 0) {
      this.armIdle(entry, key, this.config.idleShutdownMs);
    }
  }

  /**
   * Shut down a single `(workspaceRoot, serverId)` entry, if one is
   * tracked. Returns `true` when an entry existed and was torn down, `false`
   * when there was nothing to do. Used by `/lsp restart <id>` (#97) — the
   * next `acquire()` for the same key lazily spawns a fresh instance.
   */
  async shutdownOne(workspaceRoot: string, serverId: string): Promise<boolean> {
    const key = makeKey(workspaceRoot, serverId);
    const entry = this.entries.get(key);
    if (!entry) return false;
    this.clearIdle(entry);
    this.entries.delete(key);
    await entry.client.shutdown().catch(() => undefined);
    return true;
  }

  /**
   * Shut down every tracked client and clear the registry.  Leaves no
   * orphan processes; safe to call on session exit.
   */
  async shutdownAll(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const [key, entry] of [...this.entries]) {
      this.clearIdle(entry);
      promises.push(
        entry.client
          .shutdown()
          .catch(() => undefined)
          .finally(() => this.entries.delete(key)),
      );
    }
    await Promise.allSettled(promises);
    this.entries.clear();
  }

  /** Return subset of entries still alive (for status / debugging). */
  list(): {
    workspaceRoot: string;
    serverId: string;
    state: LspClientState;
    pid?: number;
  }[] {
    const result: ReturnType<ServerRegistry["list"]> = [];
    for (const [key, entry] of this.entries) {
      const [root, id] = key.split(KEY_SEPARATOR);
      result.push({
        workspaceRoot: root,
        serverId: id,
        state: entry.client.currentState,
        pid: entry.client.pid,
      });
    }
    return result;
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private createClient(
    workspaceRoot: string,
    profile: ServerProfile,
  ): LspClient {
    const opts: LspClientOptions = {
      serverId: profile.id,
      workspaceRoot,
      command: profile.command,
      args: profile.args,
      initializationOptions: profile.initializationOptions,
      requestTimeoutMs: this.config.requestTimeoutMs,
      process: {
        maxRestarts: 1,
        backoffBaseMs: 100,
        backoffMaxMs: 5_000,
      },
    };
    const client = new LspClient(opts);
    // Propagate state changes to the status callback so the footer stays
    // live without polling or waiting for tool results.
    if (this.onStatusChange) {
      client.on("state", () => this.onStatusChange?.());
      client.on("degraded", () => this.onStatusChange?.());
    }
    return client;
  }

  private armIdle(entry: RegistryEntry, key: string, idleMs: number): void {
    if (entry.activeRequests > 0) return;
    this.clearIdle(entry);
    entry.idleTimer = setTimeout(() => this.onIdle(key, entry), idleMs);
  }

  private clearIdle(entry: RegistryEntry): void {
    if (entry.idleTimer !== undefined) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = undefined;
    }
  }

  private onIdle(key: string, entry: RegistryEntry): void {
    // Re-check because a request may have been queued between the timer
    // firing and this handler running.
    if (entry.activeRequests > 0) {
      this.armIdle(entry, key, this.config.idleShutdownMs);
      return;
    }
    this.logger(
      "info",
      `idle shutdown of ${entry.profile.id} at ${entry.client.workspaceRoot}`,
    );
    void entry.client.shutdown();
    this.entries.delete(key);
  }
}
