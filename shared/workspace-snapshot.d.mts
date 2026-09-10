export const WORKSPACE_SNAPSHOT_SCHEMA_VERSION: string;

export interface WorkspacePathChange {
  status: string;
  path: string;
}

export interface WorkspaceRename {
  from: string;
  to: string;
}

export interface WorkspaceSnapshot {
  schemaVersion: string;
  head: string;
  staged: WorkspacePathChange[];
  unstaged: WorkspacePathChange[];
  untracked: string[];
  renames: WorkspaceRename[];
  deletions: Array<{ path: string }>;
  changedFiles: string[];
  fingerprint: string;
}

export type WorkspaceSnapshotErrorCode =
  | "no_repository"
  | "git_unavailable"
  | "git_command_failed"
  | "read_failed"
  | "unstable_workspace"
  | "internal_inconsistency";

export interface WorkspaceSnapshotError {
  code: WorkspaceSnapshotErrorCode;
  /** Safe to display: never file content, never patch text. */
  message: string;
}

export type WorkspaceSnapshotResult =
  | { ok: true; snapshot: WorkspaceSnapshot }
  | { ok: false; error: WorkspaceSnapshotError };

export interface CollectWorkspaceSnapshotOptions {
  /** Per Git subprocess. */
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Retry budget for mutation-during-capture detection. */
  maxAttempts?: number;
  /**
   * Test seam: runs after each attempt's cheap generation stamp is taken,
   * before patch/untracked collection. Production callers omit this.
   */
  onAttemptState?: (
    attempt: number,
    cheapState: unknown,
  ) => void | Promise<void>;
}

export function collectWorkspaceSnapshot(
  worktree: string,
  options?: CollectWorkspaceSnapshotOptions,
): Promise<WorkspaceSnapshotResult>;

/**
 * `{ ...process.env, LC_ALL: "C", LANG: "C" }` — forces English git error
 * text so callers that classify or match against it (this module's own
 * classifyGitError, or a caller running its own git subprocess for related
 * diagnostics) don't silently break on a localized host.
 */
export function gitEnv(): NodeJS.ProcessEnv;
