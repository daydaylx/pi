/**
 * Registers compacted variants of the built-in bash/read/grep/find/ls/write
 * tools with `renderShell: "self"` so ToolExecutionComponent skips its
 * Spacer(1) + Box(1, 1) padding around them (the same trick the core `edit`
 * tool already uses). Routine read/search/list tools also get a bounded
 * model-facing result; their TUI receipt remains a separate renderer concern.
 *
 * Every local basis tool gets `collapseResult()`: collapsed, successful,
 * finished results show one informative receipt plus the Ctrl+O hint instead
 * of a multi-line preview. Errors and partial output stay native and visible.
 *
 * Deliberately NOT wrapped (no proven collapsed/expanded parity): web and
 * subagent tools come from external packages whose renderers this checkout
 * does not own, and verify/project_check keep their full-output receipts on
 * purpose — their exit codes and truncation notices are verification evidence
 * (see 04-test-matrix.md) and they run far too rarely to add transcript noise.
 *
 * `cwd` is bound inside each factory's `execute` closure, so registration
 * happens on every `session_start` with `ctx.cwd`, not at module load time
 * — otherwise tools would keep running against a stale working directory
 * after a worktree switch or session resume.
 */
import type {
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
  createBashToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { collapseResult } from "./collapse-result.ts";
import { limitModelFacingToolResult } from "../shared/output-limits.ts";

function limitRoutineModelResult(
  tool: ToolDefinition<any, any, any>,
): ToolDefinition<any, any, any> {
  const execute = tool.execute;
  return {
    ...tool,
    async execute(
      toolCallId: string,
      params: any,
      signal: AbortSignal | undefined,
      onUpdate: any,
      ctx: ExtensionContext,
    ) {
      return limitModelFacingToolResult(
        await execute(toolCallId, params, signal, onUpdate, ctx),
      );
    },
  };
}

export default function compactToolsExtension(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, ctx: ExtensionContext) => {
    pi.registerTool({
      ...limitRoutineModelResult(
        collapseResult(createReadToolDefinition(ctx.cwd)),
      ),
      renderShell: "self",
    });
    pi.registerTool({
      ...limitRoutineModelResult(
        collapseResult(createGrepToolDefinition(ctx.cwd)),
      ),
      renderShell: "self",
    });
    pi.registerTool({
      ...limitRoutineModelResult(
        collapseResult(createFindToolDefinition(ctx.cwd)),
      ),
      renderShell: "self",
    });
    pi.registerTool({
      ...limitRoutineModelResult(
        collapseResult(createLsToolDefinition(ctx.cwd)),
      ),
      renderShell: "self",
    });
    pi.registerTool({
      ...collapseResult(createWriteToolDefinition(ctx.cwd)),
      renderShell: "self",
    });
    pi.registerTool({
      ...collapseResult(createBashToolDefinition(ctx.cwd)),
      renderShell: "self",
    });
  });
}
