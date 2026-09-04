import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  type WorkflowMode,
  isPlanningMode,
  workflowModeLabel,
} from "../shared/workflow-mode.ts";
import { updateWorkflowPresentation } from "./presentation.ts";
import {
  type PlanLocation,
  type StoredPlan,
  planLocation,
  readPlan,
  restorePlan,
} from "./plan-store.ts";
import { assessPlanQuality } from "./plan-quality.ts";

export type NotifyLevel = "info" | "warning" | "error";

/** What the user may still do with the plan that was just produced. */
export interface PlanReadiness {
  hash: string;
  mode: Exclude<WorkflowMode, "work">;
  /** The plan met its mode's minimum requirements when it was written. */
  qualityOk: boolean;
}

/**
 * An explicit, hash-bound execution grant.
 *
 * `hash` pins the exact plan the user approved: if the plan changes afterwards
 * — an external editor, another planning turn, a concurrent session — the hash
 * no longer matches and the grant is void rather than silently applying to text
 * nobody approved. `prompt` pins the single turn the grant belongs to, so an
 * intervening question or review turn cannot consume it.
 */
export interface PlanApproval {
  hash: string;
  prompt: string;
  sessionId: string;
  approvedAt: string;
}

export interface WorkflowSession {
  readonly pi: ExtensionAPI;
  /** What the user picked. Not necessarily what the running turn obeys. */
  selectedMode: WorkflowMode;
  /** The mode pinned for the turn in flight, if one is running. */
  activeTurnMode(): WorkflowMode | undefined;
  /** A switch requested mid-turn, applied once the turn settles. */
  pendingMode(): WorkflowMode | undefined;
  /** The mode every guard and prompt must use right now. */
  effectiveMode(): WorkflowMode;
  location(ctx: ExtensionContext): PlanLocation;
  notify(ctx: ExtensionContext, message: string, level?: NotifyLevel): void;
  setMode(ctx: ExtensionContext, mode: WorkflowMode): void;
  /** Records a mode switch, deferring it when a turn is in flight. */
  requestMode(ctx: ExtensionContext, mode: WorkflowMode): "applied" | "deferred";
  beginTurn(ctx: ExtensionContext): WorkflowMode;
  /** The plan hash this turn last saw; the compare-and-swap baseline. */
  expectedPlanHash(): string | undefined;
  recordPlanWrite(hash: string, quality: boolean): void;
  /**
   * Re-syncs readiness with the store after an out-of-band edit (the external
   * editor, which writes outside `plan_write` and so outside any turn).
   * Without this, readiness keeps pointing at the pre-edit hash forever and
   * `consumeApproval`'s hash check makes the edited plan permanently
   * unapprovable — editing would be a one-way trip out of "ready".
   */
  refreshReadinessAfterEdit(
    ctx: ExtensionContext,
    mode: Exclude<WorkflowMode, "work">,
  ): void;
  recordAgentEnd(messages?: readonly unknown[]): void;
  settleTurn(ctx: ExtensionContext): void;
  readiness(): PlanReadiness | undefined;
  clearReadiness(): void;
  approval(): PlanApproval | undefined;
  approve(approval: PlanApproval): void;
  /** Consumes the grant iff it belongs to this prompt and the plan is unchanged. */
  consumeApproval(ctx: ExtensionContext, prompt: string): StoredPlan | undefined;
  clearApproval(): void;
  resetForSession(): void;
}

export function createWorkflowSession(pi: ExtensionAPI): WorkflowSession {
  let turnMode: WorkflowMode | undefined;
  let deferredMode: WorkflowMode | undefined;
  let previousPlan: StoredPlan | undefined;
  let writtenPlan: { hash: string; quality: boolean } | undefined;
  let finalRunSucceeded = true;
  let planReadiness: PlanReadiness | undefined;
  let planApproval: PlanApproval | undefined;

  const session: WorkflowSession = {
    pi,
    selectedMode: "work",

    activeTurnMode: () => turnMode,
    pendingMode: () => deferredMode,
    // Guards, prompts and the capability bridge all read this one value. While
    // a turn runs it is the mode pinned at its start, which is what closes the
    // time-of-check/time-of-use hole: a switch made mid-turn cannot loosen the
    // boundaries the running turn was started under.
    effectiveMode: () => turnMode ?? session.selectedMode,

    location(ctx) {
      return planLocation(ctx.cwd, ctx.sessionManager.getSessionId());
    },

    notify(ctx, message, level = "info") {
      ctx.ui.notify(message, level);
    },

    setMode(ctx, mode) {
      session.selectedMode = mode;
      deferredMode = undefined;
      updateWorkflowPresentation(ctx, mode, pi);
      session.notify(ctx, `${workflowModeLabel(mode)} aktiv.`);
    },

    requestMode(ctx, mode) {
      if (turnMode === undefined) {
        session.setMode(ctx, mode);
        return "applied";
      }
      deferredMode = mode;
      updateWorkflowPresentation(ctx, session.selectedMode, pi, mode);
      session.notify(
        ctx,
        `${workflowModeLabel(mode)} ist vorgemerkt und wird nach dem laufenden Turn aktiv. Bis dahin gilt weiter ${workflowModeLabel(turnMode)}.`,
        "warning",
      );
      return "deferred";
    },

    beginTurn(ctx) {
      turnMode = session.selectedMode;
      finalRunSucceeded = true;
      writtenPlan = undefined;
      if (isPlanningMode(turnMode)) {
        previousPlan = readPlan(session.location(ctx));
        // A new planning turn invalidates whatever was ready or approved
        // before it: the plan is about to be replaced.
        planReadiness = undefined;
        planApproval = undefined;
      }
      return turnMode;
    },

    expectedPlanHash: () => writtenPlan?.hash ?? previousPlan?.hash,

    recordPlanWrite(hash, quality) {
      if (turnMode && isPlanningMode(turnMode))
        writtenPlan = { hash, quality };
    },

    refreshReadinessAfterEdit(ctx, mode) {
      const stored = readPlan(session.location(ctx));
      if (!stored) {
        planReadiness = undefined;
        return;
      }
      const quality = assessPlanQuality(mode, stored.content);
      planReadiness = { hash: stored.hash, mode, qualityOk: quality.ok };
    },

    recordAgentEnd(messages = []) {
      if (!turnMode || !isPlanningMode(turnMode)) return;
      const last = [...messages].at(-1) as
        | { errorMessage?: unknown; stopReason?: unknown }
        | undefined;
      finalRunSucceeded =
        last?.errorMessage === undefined &&
        last?.stopReason !== "error" &&
        last?.stopReason !== "aborted";
    },

    settleTurn(ctx) {
      const settledMode = turnMode;
      turnMode = undefined;
      if (settledMode && isPlanningMode(settledMode)) {
        const stored = readPlan(session.location(ctx));
        if (finalRunSucceeded && writtenPlan && stored) {
          // Whatever is stored now is the newest deliberate state: the agent's
          // write, or an edit the operator made afterwards in the external
          // editor. Rolling back on a hash mismatch would throw that edit away,
          // so the stored plan wins and readiness carries its real hash. The
          // quality verdict does not: only the text that passed the gate was
          // ever checked, and a hand-edited plan has not been.
          planReadiness = {
            hash: stored.hash,
            mode: settledMode,
            qualityOk: writtenPlan.quality && stored.hash === writtenPlan.hash,
          };
        } else {
          // A failed or aborted turn: the safe default is to restore what was
          // there before it. But "safe default" cannot mean "unconditional" —
          // if the stored content no longer matches the last state this turn
          // itself is responsible for (its own write, or the pre-turn plan if
          // it never wrote), something else changed the file during the turn.
          // In practice that is the operator's own external-editor edit made
          // while the turn was still running (the runtime has no idle gate on
          // commands, so this is reachable, not hypothetical). Restoring over
          // it would discard that edit. Only this session's own plan file is
          // ever touched either way, so this can never undo another session's
          // work — the question here is only ours vs. the turn's.
          const expected = session.expectedPlanHash();
          // A mismatch only means "keep, don't restore" when there is
          // something to keep; a missing file has nothing to preserve.
          if (stored && stored.hash !== expected) {
            // Content was never checked by the gate (neither the agent's
            // write nor this restore), so it is kept but marked not ready.
          } else {
            restorePlan(session.location(ctx), previousPlan);
          }
          planReadiness = undefined;
        }
        previousPlan = undefined;
        writtenPlan = undefined;
      }
      if (deferredMode !== undefined) {
        const next = deferredMode;
        deferredMode = undefined;
        session.setMode(ctx, next);
      }
    },

    readiness: () => planReadiness,
    clearReadiness() {
      planReadiness = undefined;
    },

    approval: () => planApproval,
    approve(approval) {
      planApproval = approval;
    },

    consumeApproval(ctx, prompt) {
      const grant = planApproval;
      if (!grant) return undefined;
      // The grant belongs to the execution turn it started, not to whatever
      // turn happens to come next: an explanation or follow-up question must
      // not quietly spend it.
      if (grant.prompt !== prompt) return undefined;
      planApproval = undefined;
      if (grant.sessionId !== ctx.sessionManager.getSessionId()) return undefined;
      const stored = readPlan(session.location(ctx));
      if (!stored || stored.hash !== grant.hash) {
        session.notify(
          ctx,
          "Die Freigabe gilt nicht mehr: Der Plan wurde seit der Freigabe geändert. Prüfe ihn mit /view-plan und gib ihn erneut frei.",
          "warning",
        );
        return undefined;
      }
      return stored;
    },
    clearApproval() {
      planApproval = undefined;
    },

    resetForSession() {
      turnMode = undefined;
      deferredMode = undefined;
      previousPlan = undefined;
      writtenPlan = undefined;
      finalRunSucceeded = true;
      // A plan from an earlier session is never executable on restart: neither
      // its readiness nor its approval survives, and the store is only ever
      // read through a fresh, explicit user action.
      planReadiness = undefined;
      planApproval = undefined;
    },
  };
  return session;
}
