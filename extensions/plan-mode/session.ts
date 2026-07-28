/**
 * Session state shared by the workflow controllers.
 *
 * Replaces the closure variables that used to live inside the extension entry.
 * The point is not indirection but reach: planning, execution and completion
 * each own their handlers now, and they all need the same three things —
 * the loaded workflow state, the planning flags, and a way to persist.
 *
 * Deliberately a plain mutable record with three methods, not a framework:
 * every persistent write still goes through the store (Umbauvertrag §13.3),
 * and the presentation is refreshed wherever the state changes so the status
 * bar can never drift from the sidecar.
 */
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { PlanKind } from "./plan-snapshot.ts";
import { updateWorkflowPresentation } from "./presentation.ts";
import {
  loadWorkflowStateV3,
  writeWorkflowStateCAS,
  type WorkflowStateLoadResult,
  type WorkflowStateV3,
} from "./store/index.ts";
import { WORKFLOW_CAPABILITY_EVENTS } from "../shared/workflow-capabilities.ts";
import { loadSetupConfig } from "../setup-core/config.ts";
import {
  computeRouting,
  formatRoutingSummary,
  type RoutingDecision,
  type RoutingInput,
} from "./routing/index.ts";

export type NotifyLevel = "info" | "warning" | "error";

export interface WorkflowSession {
  readonly pi: ExtensionAPI;
  /** Last loaded plan + sidecar view. */
  current: WorkflowStateLoadResult;
  /** Set while a planning or review turn is active. */
  planningKind?: PlanKind;
  /** Plan content the running planning turn started from. */
  planningBaseContent?: string;
  /** Whether the active planning turn is a review rather than a new plan. */
  planningIsReview: boolean;
  /** Guards against a second completion pipeline running concurrently. */
  completionRunning: boolean;
  activeCwd?: string;
  activeContext?: ExtensionContext;
  /** In-memory routing decision; not persisted and not a WorkflowStatus. */
  routing?: RoutingDecision;

  notify(ctx: ExtensionContext, message: string, level?: NotifyLevel): void;
  /** Current workflow mode for permission defaults — planning kind or work. */
  workflowMode(): "work" | PlanKind;
  /** Announce the active mode so permissions can apply their defaults. */
  publishWorkflowActivation(ctx: ExtensionContext): void;
  /** Re-read plan and sidecar from disk and refresh the status bar. */
  reload(ctx: ExtensionContext): WorkflowStateLoadResult;
  /** CAS-write a new state, then refresh the status bar. */
  replaceState(
    ctx: ExtensionContext,
    candidate: WorkflowStateV3,
  ): WorkflowStateV3;
  /**
   * Assess the task before execution: load routing config, compute the frozen
   * RoutingDecision, store it in memory and surface it. The only enforced
   * effect is phase steering; it never changes WorkflowStatus.
   */
  assessRouting(ctx: ExtensionContext, input: RoutingInput): RoutingDecision;
}

export function createWorkflowSession(pi: ExtensionAPI): WorkflowSession {
  const session: WorkflowSession = {
    pi,
    current: {
      stateToken: "missing",
      recovered: false,
      migrationRequired: false,
      warnings: [],
    },
    planningIsReview: false,
    completionRunning: false,

    notify(ctx, message, level = "info") {
      ctx.ui.notify(message, level);
    },

    workflowMode() {
      return session.planningKind ?? "work";
    },

    publishWorkflowActivation(ctx) {
      pi.events.emit(WORKFLOW_CAPABILITY_EVENTS.activated, {
        cwd: ctx.cwd,
        sessionId: ctx.sessionManager.getSessionId(),
        mode: session.workflowMode(),
      });
    },

    reload(ctx) {
      session.current = loadWorkflowStateV3(ctx.cwd);
      updateWorkflowPresentation(ctx, session.current.state);
      return session.current;
    },

    replaceState(ctx, candidate) {
      const saved = writeWorkflowStateCAS(
        ctx.cwd,
        candidate,
        session.current.stateToken,
      );
      session.current = {
        ...session.current,
        state: saved.state,
        stateToken: saved.stateToken,
        recovered: false,
      };
      updateWorkflowPresentation(ctx, saved.state);
      return saved.state;
    },

    assessRouting(ctx, input) {
      const setup = loadSetupConfig(ctx.cwd, ctx.isProjectTrusted());
      const decision = computeRouting(input, setup.config.routingProfiles);
      session.routing = decision;
      if (decision.downgradeBlocked) {
        ctx.ui.notify(decision.downgradeBlocked, "warning");
      }
      ctx.ui.notify(formatRoutingSummary(decision), "info");
      return decision;
    },
  };
  return session;
}
