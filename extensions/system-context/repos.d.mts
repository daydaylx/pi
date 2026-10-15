export interface RepoSearchOptions {
  env?: NodeJS.ProcessEnv;
  home?: string;
  cwd?: string;
  now?: () => number;
}
export interface RepoEntry {
  name: string;
  path: string;
  top: string[];
}
export function repoSearchRoots(
  options?: RepoSearchOptions,
): Array<{ dir: string; depth: number }>;
export function discoverRepos(options?: RepoSearchOptions): RepoEntry[];
export function repoContextForRequest(
  prompt: string,
  options?: RepoSearchOptions,
): string | undefined;
export function resetRepoCache(): void;
