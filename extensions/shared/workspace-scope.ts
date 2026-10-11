import { realpathSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { probeGitRepository } from "../../shared/workspace-snapshot.mjs";

export const WORKSPACE_SCOPE_EVENTS = {
  request: "workspace-scope:request",
} as const;

export interface WorkspaceScopeSnapshot {
  sessionId?: string;
  additionalRoots: string[];
}

export interface WorkspaceScopeRequest {
  sessionId?: string;
  cwd?: string;
  respond(snapshot: WorkspaceScopeSnapshot): void;
}

export interface WorkspaceScopeEventBus {
  emit(channel: string, value: unknown): void;
}

const EMPTY_SCOPE: WorkspaceScopeSnapshot = { additionalRoots: [] };

export function requestWorkspaceScope(
  events: WorkspaceScopeEventBus,
  cwd?: string,
  sessionId?: string,
): WorkspaceScopeSnapshot {
  let snapshot: WorkspaceScopeSnapshot | undefined;
  events.emit(WORKSPACE_SCOPE_EVENTS.request, {
    cwd,
    sessionId,
    respond(value: WorkspaceScopeSnapshot) {
      if (!snapshot && isWorkspaceScopeSnapshot(value)) snapshot = value;
    },
  } satisfies WorkspaceScopeRequest);
  return snapshot ?? EMPTY_SCOPE;
}

export function isWorkspaceScopeSnapshot(
  value: unknown,
): value is WorkspaceScopeSnapshot {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    (candidate.sessionId === undefined ||
      typeof candidate.sessionId === "string") &&
    Array.isArray(candidate.additionalRoots) &&
    candidate.additionalRoots.every(
      (root) => typeof root === "string" && root.startsWith("/"),
    )
  );
}

/**
 * Resolve a user-approved workspace directory to its canonical project root.
 * Git projects use their toplevel; non-Git projects use the selected
 * directory itself. Invalid Git metadata fails closed instead of silently
 * treating a broken repository as an ordinary directory.
 */
export function canonicalWorkspaceRoot(path: string): string | undefined {
  const absolute = resolve(path);
  try {
    if (!statSync(absolute).isDirectory()) return undefined;
    const canonical = realpathSync(absolute);
    const git = probeGitRepository(canonical, {
      timeoutMs: 3_000,
      maxAttempts: 1,
    });
    if (!git.ok) return undefined;
    return git.hasRepository ? git.root : canonical;
  } catch {
    return undefined;
  }
}

/**
 * Infer a root for a concrete file target only when Git supplies an
 * unambiguous project boundary. Non-Git trees require the agent to request an
 * explicit directory through the workspace approval tool.
 */
export function gitWorkspaceRootForPath(path: string): string | undefined {
  let probe = resolve(path);
  try {
    if (!statSync(probe).isDirectory()) probe = dirname(probe);
  } catch {
    // A new file may not exist yet; walk to the nearest existing directory.
  }
  while (true) {
    try {
      if (statSync(probe).isDirectory()) {
        const canonical = realpathSync(probe);
        const git = probeGitRepository(canonical, {
          timeoutMs: 3_000,
          maxAttempts: 1,
        });
        if (!git.ok) return undefined;
        if (git.hasRepository) return git.root;
        if (canonical === "/") return undefined;
        probe = dirname(canonical);
        continue;
      }
    } catch {
      // Continue upward through a missing target path.
    }
    if (probe === "/") return undefined;
    probe = dirname(probe);
  }
}
