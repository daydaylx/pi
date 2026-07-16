/**
 * Pi tools backed by the LSP client/registry (issues #95, #96).
 *
 * Every tool follows the same shape: resolve target -> acquire a server ->
 * sync the document -> issue the request -> release the server. `release()`
 * always runs, even on error, so the registry's idle timer stays correct.
 */

import { isAbsolute, join, relative, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { LspConfig, LspLogger, ServerProfile } from "./types.ts";
import { LspError } from "./types.ts";
import type { ServerRegistry } from "./registry.ts";
import type { LspClient } from "./client.ts";
import { getDocumentSync, resolveTarget } from "./documents.ts";
import type { ResolvedTarget } from "./documents.ts";
import { normalizeCapabilities } from "./capabilities.ts";
import { findWorkspaceRoot } from "./roots.ts";
import { limitTextOutput } from "../shared/output-limits.ts";

/** Default cap for lsp_references; not user-configurable to keep scope small. */
const DEFAULT_REFERENCES_LIMIT = 100;
/** How long a workspace/symbol result is reused before a fresh request. */
const WORKSPACE_SYMBOL_CACHE_TTL_MS = 30_000;

/** Wiring supplied by index.ts (#97) so tools stay decoupled from lifecycle. */
export interface LspToolsDeps {
  getConfig: () => LspConfig;
  getRegistry: () => ServerRegistry;
  logger?: LspLogger;
}

const DiagnosticsParams = Type.Object({
  path: Type.String({
    description:
      "Pfad zur Datei, absolut oder relativ zum aktuellen Arbeitsverzeichnis",
  }),
  includeRelated: Type.Optional(
    Type.Boolean({
      description: "Zugehörige Informationen (relatedInformation) mit ausgeben",
      default: false,
    }),
  ),
});

function toAbsolute(path: string, cwd: string): string {
  return isAbsolute(path) ? path : resolvePath(cwd, path);
}

export function relativeToWorkspace(
  absPath: string,
  workspaceRoot: string,
): string {
  const rel = relative(workspaceRoot, absPath);
  return rel.startsWith("..") ? absPath : rel;
}

/**
 * Renders an {@link LspError} into the plan §7.2 format: server id,
 * workspace root, method, error class, cause and remediation.
 */
export function formatLspError(error: LspError): string {
  const structured = error.toStructured();
  const lines = [
    `LSP ${structured.kind}: ${structured.serverId}`,
    `Workspace: ${structured.workspaceRoot}`,
  ];
  if (structured.method) lines.push(`Methode: ${structured.method}`);
  lines.push(`Ursache: ${structured.cause}`);
  if (structured.remediation) lines.push(`Behebung: ${structured.remediation}`);
  return lines.join("\n");
}

export interface LspToolTextResult {
  content: [{ type: "text"; text: string }];
  details?: Record<string, unknown>;
}

function lspTextResult(
  text: string,
  details?: Record<string, unknown>,
): LspToolTextResult {
  const limited = limitTextOutput(text);
  const nextDetails = limited.truncation
    ? { ...details, truncation: limited.truncation }
    : details;
  return {
    content: [{ type: "text", text: limited.text }],
    ...(nextDetails ? { details: nextDetails } : {}),
  };
}

function formatDiagnostic(
  diag: {
    severity: number;
    range: { start: { line: number; character: number } };
    message: string;
    source?: string;
  },
  includeRelated: boolean,
  related?: {
    path: string;
    range: { start: { line: number; character: number } };
    message: string;
  }[],
): string {
  const severityLabel =
    ["", "error", "warning", "info", "hint"][diag.severity] ?? "info";
  const pos = `${diag.range.start.line + 1}:${diag.range.start.character + 1}`;
  let text = `[${severityLabel}] ${pos} ${diag.message}${diag.source ? ` (${diag.source})` : ""}`;
  if (includeRelated && related?.length) {
    for (const r of related) {
      text += `\n    ${r.path}:${r.range.start.line + 1}:${r.range.start.character + 1} ${r.message}`;
    }
  }
  return text;
}

export async function runLspDiagnostics(
  deps: LspToolsDeps,
  path: string,
  cwd: string,
  includeRelated = false,
): Promise<LspToolTextResult> {
  const absPath = toAbsolute(path, cwd);
  const config = deps.getConfig();
  const target = resolveTarget(absPath, config);
  if (target instanceof LspError) return lspTextResult(formatLspError(target));

  const registry = deps.getRegistry();
  let client;
  try {
    ({ client } = await registry.acquire(target.workspaceRoot, target.profile));
  } catch (error) {
    const text =
      error instanceof LspError
        ? formatLspError(error)
        : `LSP: unerwarteter Fehler beim Start von ${target.profile.label}: ${String(error)}`;
    return lspTextResult(text);
  }

  try {
    const sync = getDocumentSync(client, target.workspaceRoot, deps.logger);
    const { version } = sync.openOrSync(absPath, target.languageId);
    const timeoutMs = Math.min(config.requestTimeoutMs, 5000);
    let snapshot;
    try {
      snapshot = await sync.waitForDiagnostics(absPath, version, timeoutMs);
    } catch (error) {
      const text =
        error instanceof LspError
          ? formatLspError(error)
          : `LSP: Fehler beim Warten auf Diagnosen: ${String(error)}`;
      return lspTextResult(text, { version });
    }

    const relPath = relativeToWorkspace(absPath, target.workspaceRoot);
    if (snapshot.diagnostics.length === 0) {
      return lspTextResult(`LSP: keine Diagnosen für ${relPath}.`, {
        version,
        count: 0,
      });
    }
    const lines = snapshot.diagnostics.map((d) =>
      formatDiagnostic(d, includeRelated, d.relatedInformation),
    );
    return lspTextResult(`${relPath}:\n${lines.join("\n")}`, {
      version,
      count: snapshot.diagnostics.length,
    });
  } finally {
    registry.release(target.workspaceRoot, target.profile.id);
  }
}

export function registerLspDiagnosticsTool(
  pi: ExtensionAPI,
  deps: LspToolsDeps,
): void {
  pi.registerTool({
    name: "lsp_diagnostics",
    label: "LSP Diagnostics",
    description:
      "Liefert aktuelle Compiler-/Linter-Diagnosen (Fehler, Warnungen) für eine Datei via Language Server Protocol. Startet den zuständigen Server bei Bedarf lazy.",
    parameters: DiagnosticsParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      return runLspDiagnostics(
        deps,
        params.path,
        ctx.cwd,
        params.includeRelated ?? false,
      );
    },
  });
}

// ---------------------------------------------------------------------------
// #96: definition, references, hover, workspace symbols
// ---------------------------------------------------------------------------

const PositionFields = {
  path: Type.String({
    description:
      "Pfad zur Datei, absolut oder relativ zum aktuellen Arbeitsverzeichnis",
  }),
  line: Type.Integer({ minimum: 0, description: "0-basierte Zeilennummer" }),
  character: Type.Integer({
    minimum: 0,
    description: "0-basierte Spaltennummer",
  }),
};

const DefinitionParams = Type.Object({
  ...PositionFields,
  preferLinks: Type.Optional(
    Type.Boolean({
      description:
        "LocationLink-Antworten bevorzugen, falls der Server sie unterstützt",
      default: false,
    }),
  ),
});

const ReferencesParams = Type.Object({
  ...PositionFields,
  includeDeclaration: Type.Optional(
    Type.Boolean({
      description: "Die Deklaration selbst mit einschließen",
      default: false,
    }),
  ),
  limit: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: 500,
      description: `Maximale Anzahl Ergebnisse (Default ${DEFAULT_REFERENCES_LIMIT})`,
    }),
  ),
});

const HoverParams = Type.Object({
  ...PositionFields,
  verbosity: Type.Optional(
    StringEnum(["brief", "full"], {
      description: "Kurzform oder vollständiger Hover-Text",
    }),
  ),
});

const WorkspaceSymbolsParams = Type.Object({
  query: Type.String({
    minLength: 1,
    description: "Suchbegriff für Workspace-Symbole",
  }),
  limit: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: 200,
      description: "Maximale Anzahl Ergebnisse",
    }),
  ),
  server: Type.Optional(
    Type.String({
      description:
        "Profil-ID (z. B. 'typescript'), falls nicht aus einer Datei ableitbar",
    }),
  ),
});

interface NormalizedLocation {
  path: string;
  line: number;
  character: number;
}

interface NormalizedSymbol {
  name: string;
  kind: number;
  path: string;
  line: number;
  character: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uriToPath(uri: unknown): string | undefined {
  if (typeof uri !== "string") return undefined;
  try {
    return fileURLToPath(uri);
  } catch {
    return undefined;
  }
}

/** Normalises a definition/references result: Location | Location[] | LocationLink[] | null. */
function toLocationList(
  result: unknown,
  workspaceRoot: string,
): NormalizedLocation[] {
  const items = Array.isArray(result) ? result : result ? [result] : [];
  const out: NormalizedLocation[] = [];
  for (const item of items) {
    if (!isRecord(item)) continue;
    // LocationLink has targetUri/targetSelectionRange; Location has uri/range.
    const uri = item.uri ?? item.targetUri;
    const range = isRecord(item.range)
      ? item.range
      : isRecord(item.targetSelectionRange)
        ? item.targetSelectionRange
        : isRecord(item.targetRange)
          ? item.targetRange
          : undefined;
    const start = isRecord(range?.start) ? range.start : undefined;
    const path = uriToPath(uri);
    if (!path || !start) continue;
    out.push({
      path: relativeToWorkspace(path, workspaceRoot),
      line: Number(start.line ?? 0),
      character: Number(start.character ?? 0),
    });
  }
  return out;
}

/** Normalises a hover result: MarkupContent | MarkedString | MarkedString[] | null. */
function toHoverText(
  result: unknown,
  verbosity: "brief" | "full",
): string | undefined {
  if (!isRecord(result)) return undefined;
  const contents = result.contents;
  let text: string | undefined;
  if (isRecord(contents) && typeof contents.value === "string") {
    text = contents.value; // MarkupContent
  } else if (typeof contents === "string") {
    text = contents; // MarkedString (string form)
  } else if (Array.isArray(contents)) {
    text = contents
      .map((c) =>
        typeof c === "string"
          ? c
          : isRecord(c) && typeof c.value === "string"
            ? c.value
            : "",
      )
      .filter(Boolean)
      .join("\n\n");
  }
  if (!text) return undefined;
  if (verbosity === "brief") {
    const firstParagraph = text.split(/\n\s*\n/)[0] ?? text;
    return firstParagraph.length > 300
      ? `${firstParagraph.slice(0, 300)}…`
      : firstParagraph;
  }
  return text;
}

function toWorkspaceSymbols(
  result: unknown,
  workspaceRoot: string,
  limit: number,
): NormalizedSymbol[] {
  const items = Array.isArray(result) ? result : [];
  const out: NormalizedSymbol[] = [];
  for (const item of items) {
    if (out.length >= limit) break;
    if (!isRecord(item)) continue;
    const location = isRecord(item.location) ? item.location : undefined;
    const range = isRecord(location?.range) ? location.range : undefined;
    const start = isRecord(range?.start) ? range.start : undefined;
    const path = uriToPath(location?.uri);
    if (!path || !start || typeof item.name !== "string") continue;
    out.push({
      name: item.name,
      kind: Number(item.kind ?? 0),
      path: relativeToWorkspace(path, workspaceRoot),
      line: Number(start.line ?? 0),
      character: Number(start.character ?? 0),
    });
  }
  return out;
}

/** Acquires a server, syncs the document, and guarantees release() on every path. */
async function withDocument<T>(
  deps: LspToolsDeps,
  target: ResolvedTarget,
  absPath: string,
  fn: (client: LspClient, version: number) => Promise<T>,
): Promise<{ text: string } | { ok: T; version: number }> {
  const registry = deps.getRegistry();
  let client: LspClient;
  try {
    ({ client } = await registry.acquire(target.workspaceRoot, target.profile));
  } catch (error) {
    const text =
      error instanceof LspError
        ? formatLspError(error)
        : `LSP: unerwarteter Fehler beim Start von ${target.profile.label}: ${String(error)}`;
    return { text };
  }
  try {
    const sync = getDocumentSync(client, target.workspaceRoot, deps.logger);
    const { version } = sync.openOrSync(absPath, target.languageId);
    const ok = await fn(client, version);
    return { ok, version };
  } catch (error) {
    const text =
      error instanceof LspError
        ? formatLspError(error)
        : `LSP: unerwarteter Fehler: ${String(error)}`;
    return { text };
  } finally {
    registry.release(target.workspaceRoot, target.profile.id);
  }
}

function softFail(
  feature: string,
  profile: ServerProfile,
) {
  return lspTextResult(
    `LSP: ${profile.label} unterstützt ${feature} nicht (Capability fehlt).`,
  );
}

export function registerLspNavigationTools(
  pi: ExtensionAPI,
  deps: LspToolsDeps,
): void {
  pi.registerTool({
    name: "lsp_definition",
    label: "LSP Definition",
    description:
      "Findet die Definitionsstelle eines Symbols an einer Position via Language Server Protocol.",
    parameters: DefinitionParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const absPath = toAbsolute(params.path, ctx.cwd);
      const config = deps.getConfig();
      const target = resolveTarget(absPath, config);
      if (target instanceof LspError) {
        return lspTextResult(formatLspError(target));
      }

      const outcome = await withDocument(
        deps,
        target,
        absPath,
        async (client) => {
          const caps = normalizeCapabilities(client.serverCapabilities);
          if (!caps.definition) return undefined;
          const uri = pathToFileURL(absPath).href;
          return client.request("textDocument/definition", {
            textDocument: { uri },
            position: { line: params.line, character: params.character },
          });
        },
      );
      if ("text" in outcome) return lspTextResult(outcome.text);
      if (outcome.ok === undefined)
        return softFail("Definitionssuche", target.profile);

      const locations = toLocationList(outcome.ok, target.workspaceRoot);
      if (locations.length === 0) {
        return lspTextResult("LSP: keine Definition gefunden.", {
          version: outcome.version,
        });
      }
      const text = locations
        .map((l) => `${l.path}:${l.line + 1}:${l.character + 1}`)
        .join("\n");
      return lspTextResult(text, { version: outcome.version });
    },
  });

  pi.registerTool({
    name: "lsp_references",
    label: "LSP References",
    description:
      "Findet alle Referenzen auf ein Symbol an einer Position via Language Server Protocol.",
    parameters: ReferencesParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const absPath = toAbsolute(params.path, ctx.cwd);
      const config = deps.getConfig();
      const target = resolveTarget(absPath, config);
      if (target instanceof LspError) {
        return lspTextResult(formatLspError(target));
      }

      const outcome = await withDocument(
        deps,
        target,
        absPath,
        async (client) => {
          const caps = normalizeCapabilities(client.serverCapabilities);
          if (!caps.references) return undefined;
          const uri = pathToFileURL(absPath).href;
          return client.request("textDocument/references", {
            textDocument: { uri },
            position: { line: params.line, character: params.character },
            context: { includeDeclaration: params.includeDeclaration ?? false },
          });
        },
      );
      if ("text" in outcome) return lspTextResult(outcome.text);
      if (outcome.ok === undefined)
        return softFail("Referenzsuche", target.profile);

      const all = toLocationList(outcome.ok, target.workspaceRoot);
      const limit = params.limit ?? DEFAULT_REFERENCES_LIMIT;
      const shown = all.slice(0, limit);
      if (shown.length === 0) {
        return lspTextResult("LSP: keine Referenzen gefunden.", {
          version: outcome.version,
        });
      }
      const lines = shown.map(
        (l) => `${l.path}:${l.line + 1}:${l.character + 1}`,
      );
      const suffix =
        all.length > shown.length
          ? `\n(${shown.length} von ${all.length} gezeigt)`
          : "";
      return lspTextResult(lines.join("\n") + suffix, {
        version: outcome.version,
        total: all.length,
        shown: shown.length,
      });
    },
  });

  pi.registerTool({
    name: "lsp_hover",
    label: "LSP Hover",
    description:
      "Liefert Typ-/Dokumentationsinformationen für ein Symbol an einer Position via Language Server Protocol.",
    parameters: HoverParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const absPath = toAbsolute(params.path, ctx.cwd);
      const config = deps.getConfig();
      const target = resolveTarget(absPath, config);
      if (target instanceof LspError) {
        return lspTextResult(formatLspError(target));
      }

      const outcome = await withDocument(
        deps,
        target,
        absPath,
        async (client) => {
          const caps = normalizeCapabilities(client.serverCapabilities);
          if (!caps.hover) return undefined;
          const uri = pathToFileURL(absPath).href;
          return client.request("textDocument/hover", {
            textDocument: { uri },
            position: { line: params.line, character: params.character },
          });
        },
      );
      if ("text" in outcome) return lspTextResult(outcome.text);
      if (outcome.ok === undefined)
        return softFail("Hover-Informationen", target.profile);

      const verbosity: "brief" | "full" =
        params.verbosity === "brief" ? "brief" : "full";
      const text = toHoverText(outcome.ok, verbosity);
      if (!text) {
        return lspTextResult("LSP: keine Hover-Informationen verfügbar.", {
          version: outcome.version,
        });
      }
      return lspTextResult(text, { version: outcome.version });
    },
  });

  const workspaceSymbolCache = new Map<
    string,
    { result: NormalizedSymbol[]; expiresAt: number }
  >();

  pi.registerTool({
    name: "lsp_workspace_symbols",
    label: "LSP Workspace Symbols",
    description:
      "Sucht Symbole (Funktionen, Klassen, …) im gesamten Workspace via Language Server Protocol.",
    parameters: WorkspaceSymbolsParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const config = deps.getConfig();

      // findWorkspaceRoot() walks up from a *file's* directory (it calls
      // dirname() internally), so probe with a synthetic path inside cwd
      // rather than cwd itself — otherwise the search would start one level
      // too high, in cwd's parent.
      const probePath = join(ctx.cwd, "__lsp_workspace_symbol_probe__");

      let profile: ServerProfile | undefined;
      let workspaceRoot: string | undefined;
      if (params.server) {
        profile = config.languages[params.server];
        if (profile?.enabled) {
          workspaceRoot =
            findWorkspaceRoot(probePath, profile.rootMarkers) ?? ctx.cwd;
        }
      } else {
        // No explicit server: pick the first enabled profile in configuration
        // order whose root markers resolve from cwd (keeps this lazy — a
        // single server start, no parallel fan-out across every profile).
        for (const candidate of Object.values(config.languages)) {
          if (!candidate.enabled) continue;
          const root = findWorkspaceRoot(probePath, candidate.rootMarkers);
          if (root) {
            profile = candidate;
            workspaceRoot = root;
            break;
          }
        }
      }

      if (!profile || !workspaceRoot) {
        return lspTextResult(
          "LSP: kein aktiviertes Serverprofil für dieses Arbeitsverzeichnis gefunden.",
        );
      }

      const limit = params.limit ?? config.workspaceSymbolLimit;
      const cacheKey = `${workspaceRoot}\0${profile.id}\0${params.query}\0${limit}`;
      const cached = workspaceSymbolCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        return lspTextResult(formatSymbols(cached.result), {
          cached: true,
          count: cached.result.length,
        });
      }

      const registry = deps.getRegistry();
      let client: LspClient;
      try {
        ({ client } = await registry.acquire(workspaceRoot, profile));
      } catch (error) {
        const text =
          error instanceof LspError
            ? formatLspError(error)
            : `LSP: unerwarteter Fehler beim Start von ${profile.label}: ${String(error)}`;
        return lspTextResult(text);
      }
      try {
        const caps = normalizeCapabilities(client.serverCapabilities);
        if (!caps.workspaceSymbols)
          return softFail("Workspace-Symbolsuche", profile);

        const result = await client.request("workspace/symbol", {
          query: params.query,
        });
        const symbols = toWorkspaceSymbols(result, workspaceRoot, limit);
        workspaceSymbolCache.set(cacheKey, {
          result: symbols,
          expiresAt: Date.now() + WORKSPACE_SYMBOL_CACHE_TTL_MS,
        });
        if (symbols.length === 0) {
          return lspTextResult("LSP: keine Symbole gefunden.");
        }
        return lspTextResult(formatSymbols(symbols), {
          cached: false,
          count: symbols.length,
        });
      } catch (error) {
        const text =
          error instanceof LspError
            ? formatLspError(error)
            : `LSP: unerwarteter Fehler: ${String(error)}`;
        return lspTextResult(text);
      } finally {
        registry.release(workspaceRoot, profile.id);
      }
    },
  });
}

function formatSymbols(symbols: NormalizedSymbol[]): string {
  return symbols
    .map((s) => `${s.name} — ${s.path}:${s.line + 1}:${s.character + 1}`)
    .join("\n");
}
