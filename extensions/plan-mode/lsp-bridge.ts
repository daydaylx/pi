/**
 * Request LSP diagnostics for the completion pipeline over the versioned RPC.
 *
 * Kept out of index.ts so the extension entry stays registration and wiring
 * only. The timeout resolves to "unavailable" per file rather than throwing:
 * a silent LSP must not block a completion, it must be reported as a check
 * that could not run.
 */
import { randomUUID } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { LSP_COMPLETION_RPC } from "../lsp/completion-rpc.ts";
import type { CompletionLspResult } from "./completion/types.ts";

const LSP_RESPONSE_TIMEOUT_MS = 20_000;

export async function requestLsp(
  pi: ExtensionAPI,
  projectRoot: string,
  files: string[],
): Promise<CompletionLspResult[]> {
  if (files.length === 0) return [];
  const requestId = randomUUID();
  return await new Promise<CompletionLspResult[]>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(
        files.map((path) => ({
          path,
          status: "unavailable",
          summary: "LSP-Completion-RPC antwortete nicht rechtzeitig.",
        })),
      );
    }, LSP_RESPONSE_TIMEOUT_MS);
    pi.events.emit(LSP_COMPLETION_RPC.request, {
      version: 1,
      requestId,
      projectRoot,
      files,
      respond(value: {
        version: 1;
        requestId: string;
        results: CompletionLspResult[];
      }): void {
        if (settled || value.requestId !== requestId) return;
        settled = true;
        clearTimeout(timer);
        resolve(value.results);
      },
    });
  });
}
