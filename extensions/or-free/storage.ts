/**
 * Filesystem-backed cache + config for the free-OpenRouter-model list.
 *
 * Mirrors the atomic-write pattern from plan-mode/utils.ts (tmp file + rename)
 * but skips the symlink-path defenses used there: that file lives at a fixed
 * path under the agent's own home directory, not at a path built from
 * untrusted project-relative input.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { FreeModelEntry } from "./openrouter-api.ts";

export const CACHE_FILENAME = "openrouter-free-models.json";
export const CONFIG_FILENAME = "openrouter-free.config.json";
export const FILTER_VERSION = 1;

export interface FreeModelsCache {
  fetchedAt: string;
  filterVersion: number;
  count: number;
  models: FreeModelEntry[];
}

export interface OrFreeConfig {
  enabled: boolean;
  autoRefresh: boolean;
  cacheTtlHours: number;
  requireToolsForCoding: boolean;
  minContextLength: number;
  includeRouterFree: boolean;
}

export const DEFAULT_CONFIG: OrFreeConfig = {
  enabled: true,
  autoRefresh: true,
  cacheTtlHours: 24,
  requireToolsForCoding: true,
  minContextLength: 16_000,
  includeRouterFree: true,
};

export function getCachePath(agentDir: string): string {
  return join(agentDir, CACHE_FILENAME);
}

export function getConfigPath(agentDir: string): string {
  return join(agentDir, CONFIG_FILENAME);
}

export function readCache(agentDir: string): FreeModelsCache | undefined {
  const path = getCachePath(agentDir);
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !Array.isArray(parsed.models)
    ) {
      return undefined;
    }
    return parsed as FreeModelsCache;
  } catch {
    return undefined;
  }
}

function atomicWriteJson(path: string, data: unknown): void {
  const temporaryPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(temporaryPath, JSON.stringify(data, null, 2), {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    renameSync(temporaryPath, path);
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
}

export function writeCacheAtomic(
  agentDir: string,
  cache: FreeModelsCache,
): void {
  mkdirSync(agentDir, { recursive: true });
  atomicWriteJson(getCachePath(agentDir), cache);
}

export function isCacheStale(
  fetchedAt: string,
  ttlHours: number,
  now: Date = new Date(),
): boolean {
  const fetchedTime = Date.parse(fetchedAt);
  if (!Number.isFinite(fetchedTime)) return true;
  const ageMs = now.getTime() - fetchedTime;
  return ageMs > ttlHours * 60 * 60 * 1000;
}

export function loadConfig(agentDir: string): OrFreeConfig {
  const path = getConfigPath(agentDir);
  if (!existsSync(path)) return DEFAULT_CONFIG;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    if (!raw || typeof raw !== "object") return DEFAULT_CONFIG;
    return { ...DEFAULT_CONFIG, ...raw };
  } catch {
    return DEFAULT_CONFIG;
  }
}
