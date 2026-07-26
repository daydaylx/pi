/** Hooks without mutable workflow state: transcript cleanup only. */
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  DECISION_INTAKE_MARKER,
  EXECUTING_PLAN_MARKER,
  isAssistantMessage,
  PLAN_MODE_MARKER,
  PLAN_REVIEW_MARKER,
} from "./workflow-presentation.ts";

export function registerWorkflowContextCleanup(pi: ExtensionAPI): void {
  pi.on("context", async (event) => {
    let lastAssistantIndex = -1;
    for (let index = event.messages.length - 1; index >= 0; index -= 1) {
      const message = event.messages[index];
      if (!message || !isAssistantMessage(message)) continue;
      const hasToolCall = message.content.some(
        (block) => block.type === "toolCall",
      );
      if (
        message.stopReason === "toolUse" ||
        (hasToolCall &&
          message.stopReason !== "error" &&
          message.stopReason !== "aborted")
      ) {
        continue;
      }
      lastAssistantIndex = index;
      break;
    }
    if (lastAssistantIndex < 0) return;
    return {
      messages: event.messages.filter((message, index) => {
        if (index >= lastAssistantIndex) return true;
        const candidate = message as AgentMessage & { customType?: string };
        if (
          candidate.customType?.startsWith("plan-") ||
          candidate.customType === "simple-plan-context"
        ) {
          return false;
        }
        if (candidate.role !== "custom") return true;
        const content = candidate.content;
        if (typeof content === "string") {
          return (
            !content.includes(PLAN_MODE_MARKER) &&
            !content.includes(PLAN_REVIEW_MARKER) &&
            !content.includes(EXECUTING_PLAN_MARKER) &&
            !content.includes(DECISION_INTAKE_MARKER)
          );
        }
        if (Array.isArray(content)) {
          return !content.some(
            (block) =>
              block.type === "text" &&
              (block.text?.includes(PLAN_MODE_MARKER) ||
                block.text?.includes(PLAN_REVIEW_MARKER) ||
                block.text?.includes(EXECUTING_PLAN_MARKER) ||
                block.text?.includes(DECISION_INTAKE_MARKER)),
          );
        }
        return true;
      }),
    };
  });
}
