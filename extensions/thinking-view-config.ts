/**
 * Config store for the thinking-view extension. Follows the load/save
 * pattern used by pi-tool-display (npm/node_modules/pi-tool-display/src/config-store.ts):
 * mtime+size fingerprint cache, defensive normalization of unknown JSON,
 * atomic writes via a .tmp file + rename.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type ThinkingViewMode = "compact" | "focus" | "off";

export interface ThinkingViewConfig {
  mode: ThinkingViewMode;
  renderThrottleMs: number;
  inactivityWarningSeconds: number;
  showModel: boolean;
  showThinkingLevel: boolean;
  showElapsedTime: boolean;
  showCharCount: boolean;
  showToolStatus: boolean;
}

export const DEFAULT_THINKING_VIEW_CONFIG: ThinkingViewConfig = {
  mode: "compact",
  renderThrottleMs: 250,
  inactivityWarningSeconds: 30,
  showModel: true,
  showThinkingLevel: true,
  showElapsedTime: true,
  showCharCount: true,
  showToolStatus: true,
};

function resolvePiAgentDir(): string {
  const configured = process.env.PI_CODING_AGENT_DIR;
  if (configured && configured.trim().length > 0) {
    if (configured === "~") return homedir();
    if (configured.startsWith("~/") || configured.startsWith("~\\")) {
      return join(homedir(), configured.slice(2));
    }
    return configured;
  }
  return join(homedir(), ".pi", "agent");
}

const CONFIG_FILE = join(
  resolvePiAgentDir(),
  "extensions",
  "thinking-view",
  "config.json",
);

function toBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function clampNumber(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function toMode(value: unknown): ThinkingViewMode {
  return value === "compact" || value === "focus" || value === "off"
    ? value
    : DEFAULT_THINKING_VIEW_CONFIG.mode;
}

function normalize(raw: unknown): ThinkingViewConfig {
  const source =
    typeof raw === "object" && raw !== null
      ? (raw as Record<string, unknown>)
      : {};
  return {
    mode: toMode(source.mode),
    renderThrottleMs: clampNumber(
      source.renderThrottleMs,
      50,
      5000,
      DEFAULT_THINKING_VIEW_CONFIG.renderThrottleMs,
    ),
    inactivityWarningSeconds: clampNumber(
      source.inactivityWarningSeconds,
      1,
      3600,
      DEFAULT_THINKING_VIEW_CONFIG.inactivityWarningSeconds,
    ),
    showModel: toBoolean(
      source.showModel,
      DEFAULT_THINKING_VIEW_CONFIG.showModel,
    ),
    showThinkingLevel: toBoolean(
      source.showThinkingLevel,
      DEFAULT_THINKING_VIEW_CONFIG.showThinkingLevel,
    ),
    showElapsedTime: toBoolean(
      source.showElapsedTime,
      DEFAULT_THINKING_VIEW_CONFIG.showElapsedTime,
    ),
    showCharCount: toBoolean(
      source.showCharCount,
      DEFAULT_THINKING_VIEW_CONFIG.showCharCount,
    ),
    showToolStatus: toBoolean(
      source.showToolStatus,
      DEFAULT_THINKING_VIEW_CONFIG.showToolStatus,
    ),
  };
}

let cachedConfigFile: string | undefined;
let cachedFingerprint: string | undefined;
let cachedConfig: ThinkingViewConfig | undefined;

function fingerprint(configFile: string): string {
  try {
    const stats = statSync(configFile);
    return `${stats.mtimeMs}:${stats.size}`;
  } catch {
    return "missing";
  }
}

export function getThinkingViewConfigPath(): string {
  return CONFIG_FILE;
}

export function loadThinkingViewConfig(
  configFile = CONFIG_FILE,
): ThinkingViewConfig {
  const current = fingerprint(configFile);
  if (
    cachedConfig &&
    cachedConfigFile === configFile &&
    cachedFingerprint === current
  ) {
    return cachedConfig;
  }

  let config = { ...DEFAULT_THINKING_VIEW_CONFIG };
  if (existsSync(configFile)) {
    try {
      config = normalize(JSON.parse(readFileSync(configFile, "utf-8")));
    } catch {
      config = { ...DEFAULT_THINKING_VIEW_CONFIG };
    }
  }

  cachedConfigFile = configFile;
  cachedFingerprint = current;
  cachedConfig = config;
  return config;
}

export function saveThinkingViewConfig(
  config: ThinkingViewConfig,
  configFile = CONFIG_FILE,
): void {
  const normalized = normalize(config);
  const tmpFile = `${configFile}.tmp`;
  try {
    mkdirSync(dirname(configFile), { recursive: true });
    writeFileSync(tmpFile, `${JSON.stringify(normalized, null, 2)}\n`, "utf-8");
    renameSync(tmpFile, configFile);
    cachedConfigFile = undefined;
    cachedFingerprint = undefined;
    cachedConfig = undefined;
  } catch {
    // Best-effort persistence; in-memory config still applies for this session.
  }
}
