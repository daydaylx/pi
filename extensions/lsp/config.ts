/**
 * LSP configuration with documented merge priority.
 *
 * Layers (lowest to highest):
 *   1. Extension defaults in {@link DEFAULTS}
 *   2. Optional global pi configuration  (--lsp, --lsp-mode, …)
 *   3. Project-local `.pi/lsp.json`       (only when the project is trusted)
 *   4. Session flags                      (highest priority)
 *
 * Issue #94 — configuration, root detection and registry.
 */

import type {
  ConfigLayers,
  LspConfig,
  LspMode,
  ServerProfile,
} from "./types.ts";
import { PROFILES } from "./server-profiles.ts";

/** Conservative extension defaults (plan §8/§10). */
const DEFAULTS: LspConfig = {
  enabled: true,
  mode: "auto",
  requestTimeoutMs: 10_000,
  idleShutdownMs: 600_000, // 10 minutes
  workspaceSymbolLimit: 50,
  languages: {},
};

/**
 * Resolve effective config from layered sources.
 *
 * `projectConfig` is **only** consulted when `trusted` is `true`; otherwise
 * it is discarded entirely. This is the trust gate mandated by the plan §8.2.
 */
export function resolveConfig(layers: ConfigLayers): LspConfig {
  const cfg = clone(DEFAULTS);

  mergeLanguageProfiles(cfg.languages, layers.defaults?.languages);

  // 2. Global pi config
  if (layers.global) {
    mergeConfig(cfg, layers.global);
    mergeLanguageProfiles(cfg.languages, layers.global.languages);
  }

  // 3. Project config (trust-gated)
  if (layers.trusted && layers.projectConfig) {
    mergeConfig(cfg, layers.projectConfig);
    mergeLanguageProfiles(cfg.languages, layers.projectConfig.languages);
  }

  // 4. Session flags win
  if (layers.sessionFlags) {
    mergeConfig(cfg, layers.sessionFlags);
    mergeLanguageProfiles(cfg.languages, layers.sessionFlags.languages);
  }

  return cfg;
}

/** Resolve a single profile entry: built-in default → project/session overrides. */
export function resolveProfileOverrides(
  base: ServerProfile,
  overrides?: Partial<ServerProfile>,
): ServerProfile {
  if (!overrides) return base;
  return {
    id: base.id,
    label: overrides.label ?? base.label,
    enabled: overrides.enabled ?? base.enabled,
    command: overrides.command ?? base.command,
    args: overrides.args ?? base.args,
    rootMarkers: overrides.rootMarkers ?? base.rootMarkers,
    initializationOptions:
      overrides.initializationOptions ?? base.initializationOptions,
    settings: overrides.settings ?? base.settings,
    notes: overrides.notes ?? base.notes,
  };
}

/** Validate that `mode` is a recognised value. */
export function parseMode(raw: unknown): LspMode | undefined {
  if (raw === "off" || raw === "auto" || raw === "force") return raw;
  return undefined;
}

// ---------------------------------------------------------------------------
// internal helpers
// ---------------------------------------------------------------------------

function mergeConfig(target: LspConfig, source: Partial<LspConfig>): void {
  if (source.enabled !== undefined) target.enabled = Boolean(source.enabled);
  if (source.mode !== undefined) target.mode = source.mode as LspMode;
  if (source.requestTimeoutMs !== undefined)
    target.requestTimeoutMs = Number(source.requestTimeoutMs);
  if (source.idleShutdownMs !== undefined)
    target.idleShutdownMs = Number(source.idleShutdownMs);
  if (source.workspaceSymbolLimit !== undefined)
    target.workspaceSymbolLimit = Number(source.workspaceSymbolLimit);
}

function mergeLanguageProfiles(
  target: Record<string, ServerProfile>,
  source?: Record<string, unknown>,
): void {
  if (!source) return;
  for (const [id, partial] of Object.entries(source)) {
    if (!partial || typeof partial !== "object") continue;
    const existing = target[id];
    if (existing) {
      target[id] = resolveProfileOverrides(
        existing,
        partial as Partial<ServerProfile>,
      );
    } else {
      target[id] = mergeWithBuiltin(id, partial as Partial<ServerProfile>);
    }
  }
}

function mergeWithBuiltin(
  id: string,
  overrides: Partial<ServerProfile>,
): ServerProfile {
  const builtin = PROFILES[id];
  if (builtin) return resolveProfileOverrides(builtin, overrides);
  // Completely custom profile: built-in is a bare minimum.
  return resolveProfileOverrides(
    {
      id,
      label: id,
      enabled: true,
      command: id,
      args: [],
      rootMarkers: [],
    },
    overrides,
  );
}

function clone(cfg: LspConfig): LspConfig {
  return {
    enabled: cfg.enabled,
    mode: cfg.mode,
    requestTimeoutMs: cfg.requestTimeoutMs,
    idleShutdownMs: cfg.idleShutdownMs,
    workspaceSymbolLimit: cfg.workspaceSymbolLimit,
    languages: { ...cfg.languages },
  };
}
