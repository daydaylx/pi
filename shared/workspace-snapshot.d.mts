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

export function collectWorkspaceSnapshot(worktree: string): WorkspaceSnapshot;
