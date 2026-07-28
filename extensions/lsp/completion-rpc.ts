import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { CompletionLspResult } from "../plan-mode/completion/types.ts";
import { runLspDiagnostics, type LspToolsDeps } from "./tools.ts";

export const LSP_COMPLETION_RPC = {
  request: "lsp:diagnostics:v1:request",
} as const;

export interface LspCompletionRequest {
  version: 1;
  requestId: string;
  projectRoot: string;
  files: string[];
  respond(result: {
    version: 1;
    requestId: string;
    results: CompletionLspResult[];
  }): void;
}

function classify(path: string, text: string): CompletionLspResult {
  if (
    /^LSP (?:missing_binary|timeout|protocol|server_exit|transport):/im.test(
      text,
    ) ||
    /^LSP: (?:unerwarteter Fehler|Fehler|ungültiger Pfad)/im.test(text)
  ) {
    return { path, status: "unavailable", summary: text };
  }
  if (/\[error\]/i.test(text)) {
    return { path, status: "fail", summary: text };
  }
  return { path, status: "pass", summary: text };
}

export function registerLspCompletionRpc(
  pi: ExtensionAPI,
  deps: LspToolsDeps,
  currentProjectRoot: () => string | undefined,
): void {
  pi.events.on(LSP_COMPLETION_RPC.request, async (value) => {
    const request = value as Partial<LspCompletionRequest>;
    if (
      request.version !== 1 ||
      typeof request.requestId !== "string" ||
      typeof request.projectRoot !== "string" ||
      !Array.isArray(request.files) ||
      !request.files.every((file) => typeof file === "string") ||
      typeof request.respond !== "function"
    ) {
      return;
    }
    if (currentProjectRoot() !== request.projectRoot) {
      request.respond({
        version: 1,
        requestId: request.requestId,
        results: request.files.map((path) => ({
          path,
          status: "unavailable",
          summary: "LSP-Session gehört zu einem anderen Projekt.",
        })),
      });
      return;
    }
    const results: CompletionLspResult[] = [];
    for (const path of request.files) {
      try {
        const result = await runLspDiagnostics(
          deps,
          path,
          request.projectRoot,
          false,
        );
        const text = result.content.map((entry) => entry.text).join("\n");
        results.push(classify(path, text));
      } catch (error) {
        results.push({
          path,
          status: "unavailable",
          summary: error instanceof Error ? error.message : String(error),
        });
      }
    }
    request.respond({
      version: 1,
      requestId: request.requestId,
      results,
    });
  });
}
