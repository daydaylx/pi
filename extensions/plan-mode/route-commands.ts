/**
 * /route: inspect or manually steer the routing decision.
 *
 * `/route` shows the current decision; `/route <level>` re-assesses the active
 * task with a manual level. Manual upgrades are always allowed; a manual
 * downgrade of a hard HIGH case is refused (the decision stays HIGH and the
 * refusal is surfaced). Routing never changes WorkflowStatus — it only steers
 * phases and records a profile recommendation in memory.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  formatRoutingSummary,
  isRoutingLevel,
  routingInputFromDirectTask,
  routingInputFromPlan,
  type RoutingInput,
  type RoutingLevel,
} from "./routing/index.ts";
import type { WorkflowSession } from "./session.ts";
import { loadDirectTask } from "./store/index.ts";

function resolveRouteInput(
  session: WorkflowSession,
  ctx: ExtensionContext,
): RoutingInput | undefined {
  const task = loadDirectTask(ctx.cwd);
  if (task) return routingInputFromDirectTask(task);
  const loaded = session.reload(ctx);
  if (loaded.snapshot) return routingInputFromPlan(loaded.snapshot);
  return undefined;
}

export async function runRoute(
  session: WorkflowSession,
  ctx: ExtensionContext,
  args: string,
): Promise<void> {
  const normalized = args.trim().toLowerCase();
  const manualLevel = isRoutingLevel(normalized)
    ? (normalized as RoutingLevel)
    : undefined;
  if (normalized && !manualLevel) {
    session.notify(ctx, "Verwendung: /route [low|standard|high]", "warning");
    return;
  }

  const baseInput = resolveRouteInput(session, ctx);
  if (!baseInput) {
    if (session.routing) {
      session.notify(ctx, formatRoutingSummary(session.routing));
    } else {
      session.notify(
        ctx,
        "Keine aktive Aufgabe zum Bewerten (starte /work oder /task).",
        "warning",
      );
    }
    return;
  }

  const input: RoutingInput = manualLevel
    ? { ...baseInput, manualLevel }
    : baseInput;
  session.assessRouting(ctx, input);
}
