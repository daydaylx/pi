/**
 * Document synchronisation and diagnostics tracking (issue #95).
 *
 * Owns the `textDocument/didOpen` / `didChange` / `didClose` lifecycle for a
 * single {@link LspClient} and dispatches `textDocument/publishDiagnostics`
 * notifications, which the client forwards unfiltered. Full-text sync only
 * (no incremental diffing) — consistent with `textDocumentSync: 1` in every
 * built-in server profile and keeps v1 simple.
 *
 * This module has no `pi` dependency and is independently testable.
 */

import { lstatSync, readFileSync } from "node:fs";
import { extname } from "node:path";
import { pathToFileURL } from "node:url";
import { LspError } from "./types.ts";
import type { LspConfig, LspLogger, ServerProfile } from "./types.ts";
import type { LspClient } from "./client.ts";
import { findWorkspaceRoot } from "./roots.ts";
import { EXTENSION_LANGUAGE_MAP } from "./server-profiles.ts";
import { resolvePathScope } from "../shared/permission-policy.ts";

export interface LspDiagnosticRange {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

export interface LspDiagnostic {
  severity: 1 | 2 | 3 | 4;
  range: LspDiagnosticRange;
  message: string;
  source?: string;
  code?: string | number;
  relatedInformation?: {
    path: string;
    range: LspDiagnosticRange;
    message: string;
  }[];
}

export interface DiagnosticsSnapshot {
  uri: string;
  version: number | undefined;
  diagnostics: LspDiagnostic[];
  receivedAt: number;
}

export interface OpenResult {
  uri: string;
  version: number;
  changed: boolean;
}

interface DocumentEntry {
  uri: string;
  version: number;
  content: string;
}

/**
 * Tracks open documents and diagnostics for one {@link LspClient}. Restart or
 * degradation invalidates all local state — the next `openOrSync()` call
 * sends `didOpen` again, since a fresh server process knows nothing about
 * previously opened documents.
 */
export class DocumentSync {
  private readonly client: LspClient;
  private readonly workspaceRoot: string;
  private readonly logger: LspLogger;
  private readonly documents = new Map<string, DocumentEntry>();
  private readonly diagnostics = new Map<string, DiagnosticsSnapshot>();
  private readonly waiters = new Map<
    string,
    { minVersion: number; resolve: (snapshot: DiagnosticsSnapshot) => void }[]
  >();
  private disposed = false;

  constructor(options: {
    client: LspClient;
    workspaceRoot: string;
    logger?: LspLogger;
  }) {
    this.client = options.client;
    this.workspaceRoot = options.workspaceRoot;
    this.logger = options.logger ?? (() => undefined);
    this.client.onNotification(this.onNotification);
    this.client.on("restart", this.onInvalidate);
    this.client.on("degraded", this.onInvalidate);
  }

  private readonly onNotification = (message: unknown): void => {
    if (!isNotification(message)) return;
    if (message.method !== "textDocument/publishDiagnostics") return;
    const params = message.params as
      | { uri?: string; version?: number; diagnostics?: LspDiagnostic[] }
      | undefined;
    if (!params?.uri) return;
    const snapshot: DiagnosticsSnapshot = {
      uri: params.uri,
      version: params.version,
      diagnostics: Array.isArray(params.diagnostics) ? params.diagnostics : [],
      receivedAt: Date.now(),
    };
    this.diagnostics.set(params.uri, snapshot);
    this.settleWaiters(params.uri, snapshot);
  };

  private readonly onInvalidate = (): void => {
    this.documents.clear();
    this.diagnostics.clear();
    // Waiters for a version that will never arrive from this server
    // instance again must not hang forever; let their timeout fire instead
    // of resolving with stale/incorrect data.
  };

  private settleWaiters(uri: string, snapshot: DiagnosticsSnapshot): void {
    const pending = this.waiters.get(uri);
    if (!pending) return;
    const remaining = pending.filter((waiter) => {
      if (
        snapshot.version === undefined ||
        snapshot.version >= waiter.minVersion
      ) {
        waiter.resolve(snapshot);
        return false;
      }
      return true;
    });
    if (remaining.length > 0) this.waiters.set(uri, remaining);
    else this.waiters.delete(uri);
  }

  /**
   * Reads `absPath` from disk and syncs it with the server: `didOpen` the
   * first time, `didChange` (full text) whenever the content differs from
   * the last synced version. Always re-reads from disk so external edits
   * are picked up before the next request.
   */
  openOrSync(absPath: string, languageId: string): OpenResult {
    // P0.2: Check for symlink escape and file size limit
    const scope = resolvePathScope(absPath, this.workspaceRoot);
    if (scope.symlinkEscape) {
      throw new LspError({
        kind: "protocol",
        serverId: "validation",
        workspaceRoot: this.workspaceRoot,
        cause: `Symlink-Escape erkannt in Pfad '${absPath}'`,
        remediation:
          "Nur reguläre Dateien innerhalb des Projekts sind zugänglich.",
      });
    }

    // P0.2: Limit file size to prevent memory exhaustion (10 MB limit)
    const MAX_FILE_SIZE = 10 * 1024 * 1024;
    let content: string;
    try {
      const stats = lstatSync(absPath);
      if (stats.size > MAX_FILE_SIZE) {
        throw new LspError({
          kind: "protocol",
          serverId: "validation",
          workspaceRoot: this.workspaceRoot,
          cause: `Datei '${absPath}' überschreitet das 10-MB-Limit (${stats.size} Bytes)`,
          remediation:
            "Kleinere Datei öffnen oder das Limit in der Konfiguration erhöhen.",
        });
      }
      content = readFileSync(absPath, "utf8");
    } catch (error) {
      const message = error instanceof LspError ? error.message : String(error);
      throw error instanceof LspError
        ? error
        : new LspError({
            kind: "protocol",
            serverId: "validation",
            workspaceRoot: this.workspaceRoot,
            cause: `Datei '${absPath}' kann nicht gelesen werden: ${message}`,
            remediation:
              "Dateiberechtigungen prüfen und ob die Datei existiert.",
          });
    }

    const uri = pathToFileURL(absPath).href;
    const existing = this.documents.get(uri);

    if (!existing) {
      const version = 1;
      this.documents.set(uri, { uri, version, content });
      this.client.notify("textDocument/didOpen", {
        textDocument: { uri, languageId, version, text: content },
      });
      return { uri, version, changed: true };
    }

    if (existing.content === content) {
      return { uri, version: existing.version, changed: false };
    }

    const version = existing.version + 1;
    this.documents.set(uri, { uri, version, content });
    this.client.notify("textDocument/didChange", {
      textDocument: { uri, version },
      contentChanges: [{ text: content }],
    });
    return { uri, version, changed: true };
  }

  /** Sends `didClose` and forgets local state for `absPath`. */
  close(absPath: string): void {
    const uri = pathToFileURL(absPath).href;
    if (!this.documents.has(uri)) return;
    this.documents.delete(uri);
    this.diagnostics.delete(uri);
    this.client.notify("textDocument/didClose", {
      textDocument: { uri },
    });
  }

  getVersion(absPath: string): number | undefined {
    const uri = pathToFileURL(absPath).href;
    return this.documents.get(uri)?.version;
  }

  getDiagnostics(absPath: string): DiagnosticsSnapshot | undefined {
    const uri = pathToFileURL(absPath).href;
    return this.diagnostics.get(uri);
  }

  /**
   * Resolves with the first diagnostics snapshot for `absPath` whose version
   * is `minVersion` or newer (push model — never polls). Rejects with an
   * {@link LspError} of kind `timeout` if none arrives in time. If a
   * matching snapshot is already cached, resolves immediately.
   */
  waitForDiagnostics(
    absPath: string,
    minVersion: number,
    timeoutMs: number,
  ): Promise<DiagnosticsSnapshot> {
    const uri = pathToFileURL(absPath).href;
    const cached = this.diagnostics.get(uri);
    if (
      cached &&
      (cached.version === undefined || cached.version >= minVersion)
    ) {
      return Promise.resolve(cached);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const list = this.waiters.get(uri);
        if (list) {
          const remaining = list.filter((w) => w.resolve !== wrappedResolve);
          if (remaining.length > 0) this.waiters.set(uri, remaining);
          else this.waiters.delete(uri);
        }
        reject(
          new LspError({
            kind: "timeout",
            serverId: this.client.serverId,
            workspaceRoot: this.workspaceRoot,
            method: "textDocument/publishDiagnostics",
            cause: `Keine Diagnosen empfangen für Version >= ${minVersion} innerhalb von ${timeoutMs}ms`,
            remediation:
              "Der Server analysiert möglicherweise noch; in Kürze erneut versuchen.",
          }),
        );
      }, timeoutMs);
      const wrappedResolve = (snapshot: DiagnosticsSnapshot): void => {
        clearTimeout(timer);
        resolve(snapshot);
      };
      const list = this.waiters.get(uri) ?? [];
      list.push({ minVersion, resolve: wrappedResolve });
      this.waiters.set(uri, list);
    });
  }

  /** Detaches all listeners. Call when the client itself is torn down. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.client.off("restart", this.onInvalidate);
    this.client.off("degraded", this.onInvalidate);
    this.documents.clear();
    this.diagnostics.clear();
    this.waiters.clear();
  }
}

function isNotification(
  value: unknown,
): value is { method: string; params?: unknown } {
  return (
    typeof value === "object" &&
    value !== null &&
    "method" in value &&
    !("id" in value)
  );
}

const registry = new WeakMap<LspClient, DocumentSync>();

/**
 * Returns the single {@link DocumentSync} for `client`, creating it on first
 * use. Reused across tool calls so document/diagnostic state persists for
 * the lifetime of the client instance.
 */
export function getDocumentSync(
  client: LspClient,
  workspaceRoot: string,
  logger?: LspLogger,
): DocumentSync {
  const existing = registry.get(client);
  if (existing) return existing;
  const sync = new DocumentSync({ client, workspaceRoot, logger });
  registry.set(client, sync);
  return sync;
}

export interface ResolvedTarget {
  profile: ServerProfile;
  languageId: string;
  workspaceRoot: string;
}

/**
 * Resolves an absolute file path to its server profile, LSP `languageId`
 * and workspace root, honouring `config.languages` overrides/enablement.
 * Returns an {@link LspError} (never throws) for unknown extensions,
 * disabled profiles or an undetectable workspace root, so tool handlers can
 * render a soft-fail instead of crashing.
 */
export function resolveTarget(
  absPath: string,
  config: LspConfig,
): ResolvedTarget | LspError {
  const ext = extname(absPath).toLowerCase();
  const mapping = EXTENSION_LANGUAGE_MAP[ext];
  if (!mapping) {
    return new LspError({
      kind: "protocol",
      serverId: "unknown",
      workspaceRoot: absPath,
      cause: `kein LSP-Profil zugeordnet für Erweiterung '${ext || "(none)"}'`,
      remediation: "Für diesen Dateityp ist kein Language Server konfiguriert.",
    });
  }

  const profile = config.languages[mapping.profileId];
  if (!profile || !profile.enabled) {
    return new LspError({
      kind: "protocol",
      serverId: mapping.profileId,
      workspaceRoot: absPath,
      cause: `Profil '${mapping.profileId}' ist deaktiviert`,
      remediation:
        "In .pi/lsp.json oder mit dem Session-Modus-Flag aktivieren.",
    });
  }

  const workspaceRoot = findWorkspaceRoot(absPath, profile.rootMarkers);
  if (!workspaceRoot) {
    return new LspError({
      kind: "protocol",
      serverId: profile.id,
      workspaceRoot: absPath,
      cause: `kein Arbeitsbereichs-Root gefunden (Marker: ${profile.rootMarkers.join(", ")})`,
      remediation: "Datei aus ihrem Projektverzeichnis heraus öffnen.",
    });
  }

  return { profile, languageId: mapping.languageId, workspaceRoot };
}
