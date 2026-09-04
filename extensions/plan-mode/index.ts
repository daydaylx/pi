/** Three-mode plan controller: mode, prompts, plan tool, commands, nothing else. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerPlanCommands } from "./commands.ts";
import { registerPlanEvents } from "./events.ts";
import { registerPlanTool } from "./plan-tool.ts";
import { createWorkflowSession } from "./session.ts";

export default function planModeExtension(pi: ExtensionAPI): void {
  const session = createWorkflowSession(pi);
  registerPlanTool(pi, session);
  registerPlanCommands(pi, session);
  registerPlanEvents(pi, session);
}
