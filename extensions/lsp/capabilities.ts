/**
 * Capability normalisation from the raw server `InitializeResult`.
 *
 * Each boolean is extracted once after handshake and cached for the
 * server instance lifetime. Tools consult this map instead of reading
 * the raw LSP capabilities directly.
 *
 * Issue #94 — configuration, root detection and registry.
 */

import type { LspCapabilities } from "./types.ts";

/**
 * Resolve a typed capability view from a raw server `InitializeResult`.
 * Unknown / missing keys default to `false` / `0`.
 */
export function normalizeCapabilities(raw?: Record<string, unknown>): LspCapabilities {
  const rawTextDoc = isRecord(raw?.textDocument) ? raw.textDocument : {};
  const rawWorkspace = isRecord(raw?.workspace) ? raw.workspace : {};

  return {
    hover: toBool(raw?.hoverProvider),
    definition: toBool(raw?.definitionProvider),
    references: toBool(raw?.referencesProvider),
    workspaceSymbols: toBool(rawWorkspace.symbol),
    textDocumentSync: Number(
      (rawTextDoc as { textDocumentSync?: number }).textDocumentSync ?? 0,
    ),
  };
}

function toBool(value: unknown): boolean {
  if (isRecord(value)) return true;
  if (typeof value === "boolean") return value;
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
