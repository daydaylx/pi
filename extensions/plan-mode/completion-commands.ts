/**
 * /finish and /task-done: orchestrate the completion pipeline.
 *
 * Split from completion.ts so the pipeline itself stays free of session,
 * UI and RPC concerns — and so this module can use the LSP bridge without
 * completion.ts and lsp-bridge.ts importing each other (no cycles, §13.12).
 *
 * Both commands run the SAME pipeline exactly once and take the SAME override
 * route (runCompletion below). What differs is only what happens to a report
 * that was produced: a plan is committed and archived, a direct task is logged
 * and cleared. Only this path may set `done`, and only after a passed pipeline
 * or an explicitly justified override (Umbauvertrag §13.6).
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  canOverrideCompletion,
  completionOverrideReport,
  formatCompletionResult,
  runCompletionPipeline,
  type CompletionPipelineResult,
} from "./completion/index.ts";
import type { PlanSnapshot } from "./plan-snapshot.ts";
import { requestLsp } from "./lsp-bridge.ts";
import {
  promptInput,
  updateWorkflowPresentation,
  workflowWarning,
} from "./presentation.ts";
import { runCompletionReviewerViaRpc } from "./reviewer-rpc.ts";
import { routingMetrics } from "./routing/index.ts";
import type { WorkflowSession } from "./session.ts";
import {
  archiveCompletedWorkflow,
  clearDirectTask,
  commitWorkflowDone,
  loadDirectTask,
  type CompletionReport,
  type DirectTask,
  type WorkflowStateV3,
} from "./store/index.ts";

/**
 * The one completion run both commands share.
 *
 * Runs the pipeline once, reports it, and — when the result may be overridden
 * at all — asks for a justification in the TUI and builds the override report
 * from that same run. Returns undefined when no report may be produced.
 */
async function runCompletion(
  session: WorkflowSession,
  ctx: ExtensionContext,
  subject: {
    plan?: PlanSnapshot;
    state?: WorkflowStateV3;
    directTask?: DirectTask;
  },
  options: { allowOverride: boolean; overrideTitle: string },
): Promise<{ result: CompletionPipelineResult; report?: CompletionReport }> {
  const result = await runCompletionPipeline({
    projectRoot: ctx.cwd,
    trusted: ctx.isProjectTrusted(),
    exec: (program, args, execOptions) =>
      session.pi.exec(program, args, {
        cwd: execOptions.cwd,
        timeout: execOptions.timeout,
        signal: execOptions.signal as AbortSignal | undefined,
      }),
    ...(subject.plan ? { plan: subject.plan } : {}),
    ...(subject.state ? { state: subject.state } : {}),
    ...(subject.directTask ? { directTask: subject.directTask } : {}),
    ...(session.routing ? { routing: routingMetrics(session.routing) } : {}),
    runReviewer: (input) => runCompletionReviewerViaRpc(session.pi, input),
    runLsp: (files) => requestLsp(session.pi, ctx.cwd, files),
  });
  session.notify(
    ctx,
    formatCompletionResult(result),
    result.status === "pass" ? "info" : "warning",
  );
  if (result.report) return { result, report: result.report };
  if (
    !options.allowOverride ||
    !canOverrideCompletion(result.checks) ||
    ctx.mode !== "tui" ||
    !ctx.hasUI
  ) {
    return { result };
  }
  const reason = (
    await promptInput(
      ctx,
      options.overrideTitle,
      "Nichtleere Begründung für das bewusste Restrisiko",
    )
  )?.trim();
  if (!reason) return { result };
  const report = completionOverrideReport(result, subject, reason);
  session.notify(ctx, `Override protokolliert: ${reason}`, "warning");
  return { result, report };
}

export async function finishWorkflow(
  session: WorkflowSession,
  ctx: ExtensionContext,
  allowOverride: boolean,
): Promise<void> {
  if (!ctx.isProjectTrusted()) {
    session.notify(
      ctx,
      "Harte Trust-Grenze: Completion ist im untrusted Projekt blockiert.",
      "error",
    );
    return;
  }
  if (session.completionRunning) return;
  let loaded = session.reload(ctx);
  if (!loaded.snapshot || !loaded.state) {
    session.notify(
      ctx,
      "Kein abschließbarer PlanSnapshot vorhanden.",
      "warning",
    );
    return;
  }
  const reviewedPlanHash = loaded.snapshot.planHash;
  session.completionRunning = true;
  try {
    if (loaded.state.status !== "reviewing") {
      loaded.state = session.replaceState(ctx, {
        ...loaded.state,
        status: "reviewing",
        activeStepId: undefined,
      });
      loaded = session.current;
    }
    const { report } = await runCompletion(
      session,
      ctx,
      { plan: loaded.snapshot, state: loaded.state },
      { allowOverride, overrideTitle: "Completion-Override" },
    );
    if (!report) {
      session.replaceState(ctx, {
        ...(session.reload(ctx).state as WorkflowStateV3),
        status: "blocked",
        activeStepId: undefined,
      });
      return;
    }

    const verified = session.reload(ctx);
    if (
      !verified.snapshot ||
      !verified.state ||
      verified.snapshot.planHash !== reviewedPlanHash ||
      verified.state.status !== "reviewing"
    ) {
      throw new Error(
        "Plan oder State änderte sich nach Review; Abschluss wurde abgebrochen.",
      );
    }
    const done = commitWorkflowDone(
      ctx.cwd,
      verified.state,
      verified.stateToken,
      report,
    );
    const archivePath = archiveCompletedWorkflow(
      ctx.cwd,
      done.state,
      done.stateToken,
      report,
    );
    session.current = {
      stateToken: "missing",
      recovered: false,
      migrationRequired: false,
      warnings: [],
    };
    updateWorkflowPresentation(ctx);
    session.notify(ctx, `Plan erfolgreich archiviert: ${archivePath}`);
  } catch (error) {
    session.notify(
      ctx,
      `Completion abgebrochen: ${workflowWarning(error)}`,
      "error",
    );
    session.reload(ctx);
  } finally {
    session.completionRunning = false;
  }
}

export async function finishDirectTask(
  session: WorkflowSession,
  ctx: ExtensionContext,
): Promise<void> {
  if (!ctx.isProjectTrusted()) {
    session.notify(
      ctx,
      "Harte Trust-Grenze: Completion ist im untrusted Projekt blockiert.",
      "error",
    );
    return;
  }
  const task = loadDirectTask(ctx.cwd);
  if (!task) {
    session.notify(ctx, "Kein aktiver Direktauftrag.", "warning");
    return;
  }
  if (session.completionRunning) return;
  session.completionRunning = true;
  try {
    const { report } = await runCompletion(
      session,
      ctx,
      { directTask: task },
      { allowOverride: true, overrideTitle: "Direct-Task-Override" },
    );
    if (!report) return;
    session.pi.appendEntry("workflow-completion", report);
    clearDirectTask(ctx.cwd);
    session.notify(
      ctx,
      report.outcome === "override"
        ? "Direktauftrag mit begründetem Override abgeschlossen; Bericht wurde in der Sitzung protokolliert."
        : "Direktauftrag abgeschlossen; Bericht wurde in der Sitzung protokolliert.",
    );
  } catch (error) {
    session.notify(
      ctx,
      `Direktauftrag nicht abgeschlossen: ${workflowWarning(error)}`,
      "error",
    );
  } finally {
    session.completionRunning = false;
  }
}
