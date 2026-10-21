export type SystemContextCategory =
  "system" | "flake" | "health" | "desktop" | "project";

export interface SystemContext {
  contextVersion: number;
  collectedAt: string;
  system?: {
    configuration?: {
      path: string;
      source: string;
      isFlake: boolean;
      revision: string;
    } | null;
  };
  [key: string]: unknown;
}

export interface SystemContextOptions {
  commandRunner?: (
    command: string,
    args: string[],
    options?: { timeout?: number; env?: Record<string, string> },
  ) => {
    available: boolean;
    exitCode?: number;
    stdout?: string;
    reason?: string;
  };
  [key: string]: unknown;
}

export function strictCategoriesForRequest(
  request: string,
): SystemContextCategory[];
export function categoriesForRequest(request: string): SystemContextCategory[];
export function commandEnvironment(
  overrides?: Record<string, string>,
): Record<string, string>;
export function collectSystemContext(
  categories?: SystemContextCategory[],
  options?: SystemContextOptions,
): SystemContext;
export function formatSystemContext(value: SystemContext): string;
export function redactContextSecrets(value: string): string;
export function discoverDotfileTargets(options?: {
  home?: string;
  configRoot?: string;
}): Record<string, string>;
export function discoverConfigRoot(options?: {
  home?: string;
  etcNixos?: string;
  cwd?: string;
  currentSystemPath?: string;
  profileSystemPath?: string;
}):
  | {
      path: string;
      source: string;
      isFlake: boolean;
      revision: string;
    }
  | undefined;
