/**
 * Optional, read-only LSP integration for Pi (Epic #92).
 *
 * #93 (transport, process, client, types), #94 (config, root detection,
 * server registry, profiles, capabilities), #95 (document sync,
 * diagnostics), #96 (definition, references, hover, workspace symbols) and
 * #97 (this entry point: flags, /lsp command, status, trust-gated project
 * config) are all implemented.
 *
 * Session start only builds a `LspConfig` and a `ServerRegistry`; no server
 * process is ever spawned here. Every `LspClient` is created lazily inside
 * `ServerRegistry.acquire()`, called from a tool's `execute()` — LSP stays
 * silent until an `lsp_*` tool is actually invoked.
 *
 * Rollback: removing the `+extensions/lsp/index.ts` entry from
 * `settings.json` fully disables LSP without touching any other extension.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import type {
  ExtensionAPI,
  ExtensionContext,
  ToolResultEvent,
} from "@earendil-works/pi-coding-agent";

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
import { resolveConfig, parseMode } from "./config.ts";
import { PROFILES } from "./server-profiles.ts";
import type { LspConfig, LspLogLevel } from "./types.ts";
import {
  registerLspDiagnosticsTool,
  registerLspNavigationTools,
} from "./tools.ts";
import type { LspToolsDeps } from "./tools.ts";
import { computeLspStatus, publishLspStatus } from "./status.ts";
export { PROFILES, EXTENSION_LANGUAGE_MAP } from "./server-profiles.ts";
export type { LanguageMapping } from "./server-profiles.ts";
export { resolveConfig, resolveProfileOverrides, parseMode } from "./config.ts";
export { findWorkspaceRoot } from "./roots.ts";
export { normalizeCapabilities } from "./capabilities.ts";
export { ServerRegistry } from "./registry.ts";
export { DocumentSync, getDocumentSync, resolveTarget } from "./documents.ts";
export type {
  DiagnosticsSnapshot,
  LspDiagnostic,
  LspDiagnosticRange,
  OpenResult,
  ResolvedTarget,
} from "./documents.ts";
export {
  registerLspDiagnosticsTool,
  registerLspNavigationTools,
  formatLspError,
  relativeToWorkspace,
} from "./tools.ts";
export type { LspToolsDeps } from "./tools.ts";

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

// ---------------------------------------------------------------------------
// #97: extension entry point — flags, /lsp command, status, trust-gated
// project config.
// ---------------------------------------------------------------------------

const LOG_BUFFER_LIMIT = 200;
const LSP_TOOL_PREFIX = "lsp_";

function defaultConfig(): LspConfig {
  return {
    enabled: true,
    mode: "auto",
    requestTimeoutMs: 10_000,
    idleShutdownMs: 600_000,
    workspaceSymbolLimit: 50,
    languages: PROFILES,
  };
}

function readProjectConfig(
  cwd: string,
  logger: (level: LspLogLevel, message: string) => void,
): Partial<LspConfig> | undefined {
  const configPath = join(cwd, CONFIG_DIR_NAME, "lsp.json");
  if (!existsSync(configPath)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8"));
    if (parsed && typeof parsed === "object")
      return parsed as Partial<LspConfig>;
    logger("error", `${configPath} does not contain a JSON object; ignoring`);
    return undefined;
  } catch (error) {
    logger(
      "error",
      `failed to parse ${configPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
}

export default function lspExtension(pi: ExtensionAPI): void {
  let config: LspConfig = defaultConfig();
  let registry: ServerRegistry | undefined;
  let sessionOverride: Partial<LspConfig> = {};
  const logBuffer: string[] = [];

  const logger = (level: LspLogLevel, message: string): void => {
    logBuffer.push(`[${level}] ${message}`);
    if (logBuffer.length > LOG_BUFFER_LIMIT) logBuffer.shift();
  };

  function buildConfig(ctx: ExtensionContext): LspConfig {
    const cliMode = parseMode(pi.getFlag("lsp-mode"));
    const trusted = ctx.isProjectTrusted();
    const projectConfig = trusted
      ? readProjectConfig(ctx.cwd, logger)
      : undefined;
    return resolveConfig({
      defaults: defaultConfig(),
      trusted,
      projectConfig,
      sessionFlags: {
        ...(cliMode ? { mode: cliMode } : {}),
        ...sessionOverride,
      },
    });
  }

  function refreshStatus(ctx: ExtensionContext): void {
    if (!registry) {
      publishLspStatus(ctx, undefined);
      return;
    }
    publishLspStatus(ctx, computeLspStatus(config, registry.list()));
  }

  const deps: LspToolsDeps = {
    getConfig: () => config,
    getRegistry: () => {
      if (!registry) registry = new ServerRegistry({ config, logger });
      return registry;
    },
    logger,
  };

  pi.registerFlag("lsp-mode", {
    description: "LSP-Aktivierungsmodus: off | auto | force",
    type: "string",
  });
  pi.registerFlag("lsp-log", {
    description: "LSP-Log-Ausführlichkeit: off | error | info | trace",
    type: "string",
  });

  registerLspDiagnosticsTool(pi, deps);
  registerLspNavigationTools(pi, deps);

  pi.on("session_start", async (_event, ctx) => {
    config = buildConfig(ctx);
    registry = new ServerRegistry({ config, logger });
    refreshStatus(ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    await registry?.shutdownAll();
    registry = undefined;
    publishLspStatus(ctx, undefined);
  });

  pi.on("tool_result", async (event: ToolResultEvent, ctx) => {
    if (!event.toolName.startsWith(LSP_TOOL_PREFIX)) return;
    refreshStatus(ctx);
  });

  pi.registerCommand("lsp", {
    description:
      "LSP steuern: status | on | off | restart [id] | servers | log",
    handler: async (args, ctx) => {
      const [sub, ...rest] = args.trim().split(/\s+/).filter(Boolean);
      switch (sub) {
        case "status":
        case undefined: {
          const state = registry
            ? computeLspStatus(config, registry.list())
            : "off";
          const servers = registry?.list() ?? [];
          const lines = [`LSP: ${state}`];
          for (const s of servers) {
            lines.push(
              `  ${s.serverId} @ ${s.workspaceRoot} — ${s.state}${s.pid ? ` (pid ${s.pid})` : ""}`,
            );
          }
          ctx.ui.notify(lines.join("\n"), "info");
          return;
        }
        case "on": {
          sessionOverride = { ...sessionOverride, enabled: true };
          config = buildConfig(ctx);
          refreshStatus(ctx);
          ctx.ui.notify("LSP aktiviert.", "info");
          return;
        }
        case "off": {
          sessionOverride = { ...sessionOverride, enabled: false };
          config = buildConfig(ctx);
          await registry?.shutdownAll();
          refreshStatus(ctx);
          ctx.ui.notify("LSP deaktiviert, alle Server gestoppt.", "info");
          return;
        }
        case "restart": {
          const id = rest[0];
          if (!registry) {
            ctx.ui.notify("LSP: kein aktiver Server.", "info");
            return;
          }
          if (id) {
            let stopped = false;
            for (const entry of registry.list()) {
              if (entry.serverId === id) {
                stopped =
                  (await registry.shutdownOne(entry.workspaceRoot, id)) ||
                  stopped;
              }
            }
            ctx.ui.notify(
              stopped
                ? `LSP: ${id} gestoppt, wird beim nächsten Bedarf neu gestartet.`
                : `LSP: kein laufender Server '${id}'.`,
              "info",
            );
          } else {
            await registry.shutdownAll();
            ctx.ui.notify(
              "LSP: alle Server gestoppt, werden bei Bedarf neu gestartet.",
              "info",
            );
          }
          refreshStatus(ctx);
          return;
        }
        case "servers": {
          const servers = registry?.list() ?? [];
          if (servers.length === 0) {
            ctx.ui.notify("LSP: keine aktiven Server.", "info");
            return;
          }
          ctx.ui.notify(
            servers
              .map(
                (s) =>
                  `${s.serverId} @ ${s.workspaceRoot} — ${s.state}${s.pid ? ` (pid ${s.pid})` : ""}`,
              )
              .join("\n"),
            "info",
          );
          return;
        }
        case "log": {
          ctx.ui.notify(
            logBuffer.length > 0
              ? logBuffer.join("\n")
              : "LSP: kein Log vorhanden.",
            "info",
          );
          return;
        }
        default:
          ctx.ui.notify(
            "Nutzung: /lsp status|on|off|restart [id]|servers|log",
            "info",
          );
      }
    },
  });
}
