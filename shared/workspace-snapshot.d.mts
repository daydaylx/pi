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
  vcs?: "git" | "none";
  workspaceRoot?: string;
  filesystemEntries?: number;
  filesystemInventoryMode?: "in-memory" | "streamed";
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
   * Soft entry threshold for switching no-Git inventories to a streaming
   * fingerprint. Every entry is still included; this bounds temporary memory.
   */
  filesystemStreamingThreshold?: number;
  /**
   * Test seam: runs after each attempt's cheap generation stamp is taken,
   * before patch/untracked collection. Production callers omit this.
   */
  onAttemptState?: (
    attempt: number,
    cheapState: unknown,
  ) => void | Promise<void>;
}

export type GitRepositoryProbeResult =
  | { ok: true; hasRepository: true; root: string }
  | { ok: true; hasRepository: false }
  | { ok: false; error: WorkspaceSnapshotError };

export function collectWorkspaceSnapshot(
  worktree: string,
  options?: CollectWorkspaceSnapshotOptions,
): Promise<WorkspaceSnapshotResult>;

/** Checks Git availability without scanning the workspace filesystem. */
export function probeGitRepository(
  worktree: string,
  options?: Pick<CollectWorkspaceSnapshotOptions, "timeoutMs" | "maxAttempts">,
): GitRepositoryProbeResult;

/**
 * `{ ...process.env, LC_ALL: "C", LANG: "C" }` — forces English git error
 * text so callers that classify or match against it (this module's own
 * classifyGitError, or a caller running its own git subprocess for related
 * diagnostics) don't silently break on a localized host.
 */
export function gitEnv(): NodeJS.ProcessEnv;
