/**
 * Pi workflow controller v3.
 *
 * The business contract lives in current-plan.md. Runtime progress lives only
 * in current-plan.state.json. This file wires the focused planning, execution,
 * completion, presentation and persistence modules together and does nothing
 * else: dependencies, command registration, event registration.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerPlanCommands } from "./commands.ts";
import { registerPlanEvents } from "./events.ts";
import { createWorkflowSession } from "./session.ts";

export default function planModeExtension(pi: ExtensionAPI): void {
  const session = createWorkflowSession(pi);
  registerPlanCommands(pi, session);
  registerPlanEvents(pi, session);
}
