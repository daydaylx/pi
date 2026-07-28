/**
 * LSP diagnostics for the changed files, translated into completion checks.
 *
 * The bridge itself lives in lsp-bridge.ts; this module only selects the files
 * worth asking about and maps the answers. LSP findings are `recommended`, so
 * an unavailable server degrades to `not_run` instead of blocking completion.
 */
import type { CompletionCheck, CompletionPipelineContext } from "./types.ts";

function lspCandidate(path: string): boolean {
  return /\.(?:[cm]?[jt]sx?|py|rs|go|c|cc|cpp|h|hpp|java|zig)$/i.test(path);
}

export function selectLspFiles(paths: readonly string[]): string[] {
  return paths.filter(lspCandidate);
}

export async function runLspChecks(
  ctx: CompletionPipelineContext,
  files: readonly string[],
): Promise<CompletionCheck[]> {
  const checks: CompletionCheck[] = [];
  try {
    const results = await ctx.runLsp([...files]);
    for (const result of results) {
      checks.push({
        name: `lsp/${result.path}`,
        classification: "recommended",
        status:
          result.status === "pass"
            ? "pass"
            : result.status === "fail"
              ? "fail"
              : "not_run",
        summary: result.summary,
      });
    }
  } catch (error) {
    // With nothing to diagnose, an unreachable bridge is not a finding.
    if (files.length > 0) {
      checks.push({
        name: "lsp",
        classification: "recommended",
        status: "not_run",
        summary: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return checks;
}
