/**
 * Pi tools backed by the LSP client/registry (issues #95, #96).
 *
 * Every tool follows the same shape: resolve target -> acquire a server ->
 * sync the document -> issue the request -> release the server. `release()`
 * always runs, even on error, so the registry's idle timer stays correct.
 */

import { isAbsolute, relative, resolve as resolvePath } from "node:path";
import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { LspConfig, LspLogger } from "./types.ts";
import { LspError } from "./types.ts";
import type { ServerRegistry } from "./registry.ts";
import { formatErrorMessage } from "./client.ts";
import { getDocumentSync, resolveTarget } from "./documents.ts";
import { limitTextOutput } from "../shared/output-limits.ts";
import { resolvePathScope } from "../shared/permission-policy.ts";

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
  // P0.2: Block absolute paths outside the project (system paths).
  // Returns the resolved path or throws an LspError; callers use
  // resolveToolPath() to convert the error into a structured tool result.
  if (isAbsolute(path)) {
    const scope = resolvePathScope(path, cwd);
    if (!scope.insideProject) {
      throw new LspError({
        kind: "protocol",
        serverId: "validation",
        workspaceRoot: cwd,
        cause: `Pfad '${path}' liegt außerhalb des Projekts`,
        remediation:
          "Nur Dateien innerhalb des aktuellen Projekts sind zugänglich.",
      });
    }
    return path;
  }
  return resolvePath(cwd, path);
}

/**
 * Resolves a tool `path` argument safely. On success returns `{ absPath }`;
 * on failure returns `{ error }` with a pre-formatted message suitable for a
 * tool result. Centralises the P0.2 outside-project guard so every tool
 * handles it consistently instead of crashing on an uncaught throw.
 */
function resolveToolPath(
  path: string,
  cwd: string,
): { absPath: string } | { error: string } {
  try {
    return { absPath: toAbsolute(path, cwd) };
  } catch (error) {
    return {
      error:
        error instanceof LspError
          ? formatLspError(error)
          : `LSP: ungültiger Pfad '${path}': ${formatErrorMessage(error)}`,
    };
  }
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
  const resolved = resolveToolPath(path, cwd);
  if ("error" in resolved) return lspTextResult(resolved.error);
  const absPath = resolved.absPath;
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
        : `LSP: unerwarteter Fehler beim Start von ${target.profile.label}: ${formatErrorMessage(error)}`;
    return lspTextResult(text);
  }

  try {
    const sync = getDocumentSync(client, target.workspaceRoot, deps.logger);
    const { version } = sync.openOrSync(absPath, target.languageId);
    // Diagnostics are asynchronous and a cold workspace can take longer than
    // five seconds. Honour the configured request timeout like every other
    // LSP operation instead of applying a hidden, shorter cap.
    const timeoutMs = config.requestTimeoutMs;
    let snapshot;
    try {
      snapshot = await sync.waitForDiagnostics(absPath, version, timeoutMs);
    } catch (error) {
      const text =
        error instanceof LspError
          ? formatLspError(error)
          : `LSP: Fehler beim Warten auf Diagnosen: ${formatErrorMessage(error)}`;
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
    label: "LSP-Diagnosen",
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
