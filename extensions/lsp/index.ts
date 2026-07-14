/**
 * Optional, read-only LSP integration for Pi (Epic #92).
 *
 * #93 (transport, process, client, types) and #94 (config, root detection,
 * server registry, profiles, capabilities) are implemented.  This entry
 * point is intentionally NOT registered in `settings.json` yet: nothing
 * activates automatically and no server starts without explicit demand.
 * Tools and /lsp command arrive in #95–#97 and will compose the pieces
 * exported here.
 *
 * Rollback: removing the (future) `+extensions/lsp/index.ts` entry from
 * `settings.json` fully disables LSP without touching any other extension.
 */

export { LspTransport, parseStreamChunk } from "./transport.ts";
export type {
  ParsedStream,
  PendingRequest,
  RequestOptions,
  TransportHandlers,
  TransportOptions,
} from "./transport.ts";
export { LspProcess } from "./process.ts";
export type {
  DegradedInfo,
  LspProcessOptions,
  ProcessExitInfo,
} from "./process.ts";
export { LspClient } from "./client.ts";
export type { LspClientOptions, LspClientState } from "./client.ts";
export { LspError } from "./types.ts";
export type {
  JsonRpcError,
  JsonRpcMessage,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcResponse,
  LspErrorKind,
  LspInitializeParams,
  LspInitializeResult,
  LspLogLevel,
  LspLogger,
  LspStructuredError,
  LspMode,
  ServerProfile,
  LspConfig,
  ConfigLayers,
  LspCapabilities,
} from "./types.ts";

import { LspClient } from "./client.ts";
import type { LspClientOptions } from "./client.ts";
import { ServerRegistry } from "./registry.ts";
import type { RegistryOptions } from "./registry.ts";
import { resolveConfig } from "./config.ts";
export { PROFILES } from "./server-profiles.ts";
export { resolveConfig, resolveProfileOverrides, parseMode } from "./config.ts";
export { findWorkspaceRoot } from "./roots.ts";
export { normalizeCapabilities } from "./capabilities.ts";
export { ServerRegistry } from "./registry.ts";

/**
 * Create a ready-to-start client. The server is not spawned until `start()`
 * is called, which keeps LSP lazy by construction.
 */
export function createLspClient(options: LspClientOptions): LspClient {
  return new LspClient(options);
}

/**
 * Create a server registry backed by a resolved configuration.  The
 * registry handles lazy start, instance reuse, idle shutdown, and
 * structured error reporting for missing/degraded servers.
 */
export function createLspRegistry(options: RegistryOptions): ServerRegistry {
  return new ServerRegistry(options);
}
