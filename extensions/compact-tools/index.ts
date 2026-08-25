/**
 * Registers compacted variants of the built-in bash/read/grep/find/ls/write
 * tools: identical execute/renderCall, but `renderShell: "self"` so
 * ToolExecutionComponent skips its Spacer(1) + Box(1, 1) padding around them
 * (the same trick the core `edit` tool already uses).
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

export default function compactToolsExtension(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, ctx: ExtensionContext) => {
    pi.registerTool({
      ...collapseResult(createReadToolDefinition(ctx.cwd)),
      renderShell: "self",
    });
    pi.registerTool({
      ...collapseResult(createGrepToolDefinition(ctx.cwd)),
      renderShell: "self",
    });
    pi.registerTool({
      ...collapseResult(createFindToolDefinition(ctx.cwd)),
      renderShell: "self",
    });
    pi.registerTool({
      ...collapseResult(createLsToolDefinition(ctx.cwd)),
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
