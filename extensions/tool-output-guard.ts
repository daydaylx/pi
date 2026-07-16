import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { limitTextOutput } from "./shared/output-limits.ts";

export default function toolOutputGuard(pi: ExtensionAPI): void {
  pi.on("tool_result", async (event) => {
    if (event.toolName !== "subagent") return;
    const textBlocks = event.content.filter(
      (block): block is { type: "text"; text: string } => block.type === "text",
    );
    if (textBlocks.length === 0) return;

    const combined = textBlocks.map((block) => block.text).join("\n\n");
    const limited = limitTextOutput(combined);
    if (!limited.truncation) return;

    const content: typeof event.content = [];
    let insertedText = false;
    for (const block of event.content) {
      if (block.type !== "text") {
        content.push(block);
      } else if (!insertedText) {
        content.push({ type: "text", text: limited.text });
        insertedText = true;
      }
    }
    return {
      content,
      details: event.details,
      isError: event.isError,
    };
  });
}
