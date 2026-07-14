/**
 * Optional, read-only LSP integration for Pi (Epic #92).
 *
 * Issue #93 ships only the protocol foundation (transport, process lifecycle,
 * client, fake server). This entry point is intentionally NOT registered in
 * `settings.json` yet: nothing activates automatically and no server starts
 * without explicit demand. The registry, configuration, tools and `/lsp`
 * command arrive in #94–#97 and will compose the pieces exported here.
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
} from "./types.ts";

import { LspClient } from "./client.ts";
import type { LspClientOptions } from "./client.ts";

/**
 * Create a ready-to-start client. The server is not spawned until `start()`
 * is called, which keeps LSP lazy by construction.
 */
export function createLspClient(options: LspClientOptions): LspClient {
  return new LspClient(options);
}
