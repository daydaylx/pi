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
import { getDocumentSync, resolveTarget } from "./documents.ts";

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
      const absPath = toAbsolute(params.path, ctx.cwd);
      const config = deps.getConfig();
      const target = resolveTarget(absPath, config);
      if (target instanceof LspError) {
        return { content: [{ type: "text", text: formatLspError(target) }] };
      }

      const registry = deps.getRegistry();
      let client;
      try {
        ({ client } = await registry.acquire(
          target.workspaceRoot,
          target.profile,
        ));
      } catch (error) {
        const text =
          error instanceof LspError
            ? formatLspError(error)
            : `LSP: unerwarteter Fehler beim Start von ${target.profile.label}: ${String(error)}`;
        return { content: [{ type: "text", text }] };
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
          return { content: [{ type: "text", text }], details: { version } };
        }

        const relPath = relativeToWorkspace(absPath, target.workspaceRoot);
        if (snapshot.diagnostics.length === 0) {
          return {
            content: [
              { type: "text", text: `LSP: keine Diagnosen für ${relPath}.` },
            ],
            details: { version, count: 0 },
          };
        }
        const lines = snapshot.diagnostics.map((d) =>
          formatDiagnostic(
            d,
            params.includeRelated ?? false,
            d.relatedInformation,
          ),
        );
        return {
          content: [{ type: "text", text: `${relPath}:\n${lines.join("\n")}` }],
          details: { version, count: snapshot.diagnostics.length },
        };
      } finally {
        registry.release(target.workspaceRoot, target.profile.id);
      }
    },
  });
}
