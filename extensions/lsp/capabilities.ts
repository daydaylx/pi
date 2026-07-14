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
export function normalizeCapabilities(
  raw?: Record<string, unknown>,
): LspCapabilities {
  const rawTextDoc = isRecord(raw?.textDocument) ? raw.textDocument : {};

  return {
    hover: toBool(raw?.hoverProvider),
    definition: toBool(raw?.definitionProvider),
    references: toBool(raw?.referencesProvider),
    // Per LSP 3.17, workspace symbol support is announced as the top-level
    // `workspaceSymbolProvider` (like hoverProvider/definitionProvider), not
    // nested under `workspace.symbol` — that shape does not appear in any
    // real InitializeResult. Fixed as part of #96.
    workspaceSymbols: toBool(raw?.workspaceSymbolProvider),
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
