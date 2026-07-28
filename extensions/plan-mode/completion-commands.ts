/**
 * /finish and /task-done: orchestrate the completion pipeline.
 *
 * Split from completion.ts so the pipeline itself stays free of session,
 * UI and RPC concerns — and so this module can use the LSP bridge without
 * completion.ts and lsp-bridge.ts importing each other (no cycles, §13.12).
 *
 * Only this path may set `done`, and only after a passed pipeline or an
 * explicitly justified override (Umbauvertrag §13.6).
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  canOverrideCompletion,
  completionOverrideReport,
  formatCompletionResult,
  runCompletionPipeline,
} from "./completion/index.ts";
import { requestLsp } from "./lsp-bridge.ts";
import {
  promptInput,
  updateWorkflowPresentation,
  workflowWarning,
} from "./presentation.ts";
import { runCompletionReviewerViaRpc } from "./reviewer-rpc.ts";
import type { WorkflowSession } from "./session.ts";
import {
  archiveCompletedWorkflow,
  clearDirectTask,
  commitWorkflowDone,
  loadDirectTask,
  type WorkflowStateV3,
} from "./store/index.ts";

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
    const result = await runCompletionPipeline({
      projectRoot: ctx.cwd,
      trusted: ctx.isProjectTrusted(),
      exec: (program, args, options) =>
        session.pi.exec(program, args, {
          cwd: options.cwd,
          timeout: options.timeout,
          signal: options.signal as AbortSignal | undefined,
        }),
      plan: loaded.snapshot,
      state: loaded.state,
      runReviewer: (input) => runCompletionReviewerViaRpc(session.pi, input),
      runLsp: (files) => requestLsp(session.pi, ctx.cwd, files),
    });
    session.notify(
      ctx,
      formatCompletionResult(result),
      result.status === "pass" ? "info" : "warning",
    );

    let report = result.report;
    if (
      !report &&
      canOverrideCompletion(result.checks) &&
      allowOverride &&
      ctx.mode === "tui" &&
      ctx.hasUI
    ) {
      const reason = (
        await promptInput(
          ctx,
          "Completion-Override",
          "Nichtleere Begründung für das bewusste Restrisiko",
        )
      )?.trim();
      if (reason && loaded.snapshot)
        report = completionOverrideReport(result, loaded.snapshot, reason);
    }
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
    session.notify(ctx, "Keine aktive direkte Aufgabe.", "warning");
    return;
  }
  if (session.completionRunning) return;
  session.completionRunning = true;
  try {
    const pipelineContext = {
      projectRoot: ctx.cwd,
      trusted: ctx.isProjectTrusted(),
      exec: (program, args, options) =>
        session.pi.exec(program, args, {
          cwd: options.cwd,
          timeout: options.timeout,
          signal: options.signal as AbortSignal | undefined,
        }),
      directTask: task,
      runReviewer: (input) => runCompletionReviewerViaRpc(session.pi, input),
      runLsp: (files) => requestLsp(session.pi, ctx.cwd, files),
    } satisfies Parameters<typeof runCompletionPipeline>[0];
    let result = await runCompletionPipeline(pipelineContext);
    session.notify(
      ctx,
      formatCompletionResult(result),
      result.status === "pass" ? "info" : "warning",
    );
    if (
      !result.report &&
      canOverrideCompletion(result.checks) &&
      ctx.mode === "tui" &&
      ctx.hasUI
    ) {
      const reason = (
        await promptInput(
          ctx,
          "Direct-Task-Override",
          "Nichtleere Begründung für den Abschluss trotz Befund",
        )
      )?.trim();
      if (reason) {
        result = await runCompletionPipeline(pipelineContext, {
          overrideReason: reason,
        });
        session.notify(
          ctx,
          `${formatCompletionResult(result)}\n\nOverride protokolliert: ${reason}`,
          "warning",
        );
      }
    }
    if (!result.report) return;
    session.pi.appendEntry("workflow-completion", result.report);
    clearDirectTask(ctx.cwd);
    session.notify(
      ctx,
      result.report.outcome === "override"
        ? "Direkte Aufgabe mit begründetem Override abgeschlossen; Bericht wurde in der Sitzung protokolliert."
        : "Direkte Aufgabe abgeschlossen; Bericht wurde in der Sitzung protokolliert.",
    );
  } catch (error) {
    session.notify(
      ctx,
      `Direct Task nicht abgeschlossen: ${workflowWarning(error)}`,
      "error",
    );
  } finally {
    session.completionRunning = false;
  }
}
