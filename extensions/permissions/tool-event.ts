/**
 * Reading a file path out of a tool call event.
 *
 * Its own module because all three policy layers need it and none of them may
 * depend on another: workflow-policy runs before tool-policy, and guards uses
 * it again to describe the subject of a confirmation prompt.
 */
import type { ToolCallEvent } from "@earendil-works/pi-coding-agent";

export function toolPath(event: ToolCallEvent): string | undefined {
  const input = event.input as Record<string, unknown>;
  return typeof input.path === "string"
    ? input.path
    : typeof input.filePath === "string"
      ? input.filePath
      : undefined;
}
