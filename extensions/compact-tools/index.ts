/**
 * Registers compacted variants of the built-in read/grep/find/ls/write
 * tools: identical execute/renderCall/renderResult, but `renderShell:
 * "self"` so ToolExecutionComponent skips its Spacer(1) + Box(1, 1) padding
 * around them (the same trick the core `edit` tool already uses).
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
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
} from "@earendil-works/pi-coding-agent";

export default function compactToolsExtension(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, ctx: ExtensionContext) => {
    pi.registerTool({
      ...createReadToolDefinition(ctx.cwd),
      renderShell: "self",
    });
    pi.registerTool({
      ...createGrepToolDefinition(ctx.cwd),
      renderShell: "self",
    });
    pi.registerTool({
      ...createFindToolDefinition(ctx.cwd),
      renderShell: "self",
    });
    pi.registerTool({
      ...createLsToolDefinition(ctx.cwd),
      renderShell: "self",
    });
    pi.registerTool({
      ...createWriteToolDefinition(ctx.cwd),
      renderShell: "self",
    });
  });
}
