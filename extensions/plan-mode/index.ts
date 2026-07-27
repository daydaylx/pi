/**
 * Pi workflow controller v3.
 *
 * The business contract lives in current-plan.md. Runtime progress lives only
 * in current-plan.state.json. This file wires the focused planning, execution,
 * completion, presentation and persistence modules together.
 */
import { existsSync, readFileSync } from "node:fs";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { CONTROL_CENTER_EVENTS } from "../shared/control-center-events.ts";
import { SHORTCUTS } from "../shared/shortcuts.ts";
import {
  WORKFLOW_CAPABILITY_EVENTS,
  type WorkflowCapabilityRequest,
} from "../shared/workflow-capabilities.ts";
import {
  completionOverrideReport,
  formatCompletionResult,
  runCompletionPipeline,
} from "./completion.ts";
import { requestLsp } from "./lsp-bridge.ts";
import {
  executionPrompt,
  pauseExecution,
  startOrResumeExecution,
  updateExecutionStep,
} from "./execution.ts";
import {
  finalizePlanningTurn,
  planningPrompt,
  reviewPrompt,
} from "./planning.ts";
import type { PlanKind } from "./plan-snapshot.ts";
import {
  clearWorkflowPresentation,
  formatPlanSteps,
  updateWorkflowPresentation,
  workflowWarning,
} from "./presentation.ts";
import { runCompletionReviewerViaRpc } from "./reviewer-rpc.ts";
import {
  PLAN_RELATIVE_PATH,
  archiveCompletedWorkflow,
  clearDirectTask,
  clearWorkflowLockAfterConfirmation,
  commitWorkflowDone,
  discardActiveWorkflow,
  finalizeObservedPlanCAS,
  loadDirectTask,
  loadWorkflowStateV3,
  migrateLegacyWorkflowToV3,
  saveDirectTask,
  workflowPath,
  writeWorkflowStateCAS,
  type WorkflowStateLoadResult,
  type WorkflowStateV3,
} from "./store/index.ts";

const STEP_STATUSES = ["in_progress", "completed", "blocked"] as const;
const PlanProgressParams = Type.Object({
  stepId: Type.String({
    minLength: 36,
    maxLength: 36,
    description: "Stabile PI-STEP-ID aus dem aktuellen Ausführungskontext",
  }),
  status: StringEnum(STEP_STATUSES),
  evidence: Type.String({ minLength: 1, maxLength: 1000 }),
});

type MutableUi = ExtensionContext["ui"] & {
  input?: (title: string, placeholder?: string) => Promise<string | undefined>;
};

function textResult(text: string, details: Record<string, unknown> = {}) {
  return {
    content: [{ type: "text" as const, text }],
    details,
  };
}

function planContent(cwd: string): string | undefined {
  const path = workflowPath(cwd, PLAN_RELATIVE_PATH);
  return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}

export default function planModeExtension(pi: ExtensionAPI): void {
  let current: WorkflowStateLoadResult = {
    stateToken: "missing",
    recovered: false,
    migrationRequired: false,
    warnings: [],
  };
  let activeCwd: string | undefined;
  let activeContext: ExtensionContext | undefined;
  let planningKind: PlanKind | undefined;
  let planningBaseContent: string | undefined;
  let planningIsReview = false;
  let completionRunning = false;

  const notify = (
    ctx: ExtensionContext,
    message: string,
    level: "info" | "warning" | "error" = "info",
  ): void => ctx.ui.notify(message, level);

  function workflowMode(): "work" | PlanKind {
    return planningKind ?? "work";
  }

  function publishWorkflowActivation(ctx: ExtensionContext): void {
    pi.events.emit(WORKFLOW_CAPABILITY_EVENTS.activated, {
      cwd: ctx.cwd,
      sessionId: ctx.sessionManager.getSessionId(),
      mode: workflowMode(),
    });
  }

  function reload(ctx: ExtensionContext): WorkflowStateLoadResult {
    current = loadWorkflowStateV3(ctx.cwd);
    updateWorkflowPresentation(ctx, current.state);
    return current;
  }

  function replaceState(
    ctx: ExtensionContext,
    candidate: WorkflowStateV3,
  ): WorkflowStateV3 {
    const saved = writeWorkflowStateCAS(ctx.cwd, candidate, current.stateToken);
    current = {
      ...current,
      state: saved.state,
      stateToken: saved.stateToken,
      recovered: false,
    };
    updateWorkflowPresentation(ctx, saved.state);
    return saved.state;
  }

  async function choosePlanKind(
    args: string,
    ctx: ExtensionContext,
  ): Promise<PlanKind | undefined> {
    const normalized = args.trim().toLowerCase();
    if (["quick", "schnell", "simple"].includes(normalized))
      return "simple_plan";
    if (["architecture", "architektur", "detailed"].includes(normalized))
      return "detailed_plan";
    const choice = await ctx.ui.select("Planart", [
      "Schnellplan",
      "Architekturplan",
    ]);
    return choice === "Schnellplan"
      ? "simple_plan"
      : choice === "Architekturplan"
        ? "detailed_plan"
        : undefined;
  }

  async function beginPlanning(
    kind: PlanKind,
    ctx: ExtensionContext,
  ): Promise<void> {
    if (!ctx.isProjectTrusted()) {
      notify(
        ctx,
        "Harte Trust-Grenze: Planung schreibt keine Artefakte in einem untrusted Projekt.",
        "error",
      );
      return;
    }
    reload(ctx);
    if (loadDirectTask(ctx.cwd)) {
      notify(
        ctx,
        "Eine direkte Aufgabe ist aktiv; schließe sie zuerst mit /task-done ab.",
        "warning",
      );
      return;
    }
    if (current.migrationRequired) {
      notify(
        ctx,
        "Vor einer neuen Planung ist /migrate-plan erforderlich.",
        "warning",
      );
      return;
    }
    if (current.planContent) {
      const confirmed = await ctx.ui.confirm(
        "Aktiven Plan überarbeiten?",
        "Die nächste Planrevision invalidiert bisherigen Fortschritt und Review.",
      );
      if (!confirmed) return;
    }
    planningKind = kind;
    planningBaseContent = current.planContent;
    planningIsReview = false;
    updateWorkflowPresentation(ctx, current.state, "planning");
    publishWorkflowActivation(ctx);
    pi.sendMessage(
      {
        customType: "pi-plan-request",
        content:
          kind === "detailed_plan"
            ? "Erstelle jetzt den Architekturplan."
            : "Erstelle jetzt den Schnellplan.",
        display: true,
      },
      { triggerTurn: true },
    );
    notify(ctx, "Planung gestartet; es wird noch nichts implementiert.");
  }

  async function beginReview(ctx: ExtensionContext): Promise<void> {
    if (!ctx.isProjectTrusted()) {
      notify(
        ctx,
        "Harte Trust-Grenze: Plan-Review ist im untrusted Projekt blockiert.",
        "error",
      );
      return;
    }
    const loaded = reload(ctx);
    if (!loaded.snapshot || !loaded.planContent) {
      notify(ctx, "Kein gültiger PlanSnapshot v3 vorhanden.", "warning");
      return;
    }
    planningKind = loaded.snapshot.planType;
    planningBaseContent = loaded.planContent;
    planningIsReview = true;
    updateWorkflowPresentation(ctx, loaded.state, "reviewing");
    publishWorkflowActivation(ctx);
    pi.sendMessage(
      {
        customType: "pi-plan-review",
        content: "Prüfe jetzt den aktuellen PlanSnapshot.",
        display: true,
      },
      { triggerTurn: true },
    );
  }

  async function startWork(ctx: ExtensionContext): Promise<void> {
    if (!ctx.isProjectTrusted()) {
      notify(
        ctx,
        "Harte Trust-Grenze: /work ist im untrusted Projekt blockiert.",
        "error",
      );
      return;
    }
    const loaded = reload(ctx);
    if (loaded.migrationRequired) {
      notify(
        ctx,
        "Legacy-State zuerst ausdrücklich mit /migrate-plan migrieren.",
        "warning",
      );
      return;
    }
    if (!loaded.snapshot || !loaded.state) {
      notify(
        ctx,
        loaded.warnings.join("\n") || "Kein gültiger PlanSnapshot vorhanden.",
        "warning",
      );
      return;
    }
    if (
      loaded.state.status === "working" ||
      loaded.state.status === "paused" ||
      loaded.state.status === "blocked"
    ) {
      const confirmed = await ctx.ui.confirm(
        "Planausführung fortsetzen?",
        "Der gespeicherte Fortschritt wird konservativ fortgesetzt; eine Übernahme erfolgt nie zeitgesteuert.",
      );
      if (!confirmed) return;
    }
    const saved = replaceState(ctx, startOrResumeExecution(loaded.state));
    publishWorkflowActivation(ctx);
    pi.sendMessage(
      {
        customType: "pi-work-request",
        content: executionPrompt(loaded.snapshot, saved),
        display: true,
      },
      { triggerTurn: true },
    );
  }

  async function finishWorkflow(
    ctx: ExtensionContext,
    allowOverride: boolean,
  ): Promise<void> {
    if (!ctx.isProjectTrusted()) {
      notify(
        ctx,
        "Harte Trust-Grenze: Completion ist im untrusted Projekt blockiert.",
        "error",
      );
      return;
    }
    if (completionRunning) return;
    let loaded = reload(ctx);
    if (!loaded.snapshot || !loaded.state) {
      notify(ctx, "Kein abschließbarer PlanSnapshot vorhanden.", "warning");
      return;
    }
    const reviewedPlanHash = loaded.snapshot.planHash;
    completionRunning = true;
    try {
      if (loaded.state.status !== "reviewing") {
        loaded.state = replaceState(ctx, {
          ...loaded.state,
          status: "reviewing",
          activeStepId: undefined,
        });
        loaded = current;
      }
      const result = await runCompletionPipeline({
        projectRoot: ctx.cwd,
        trusted: ctx.isProjectTrusted(),
        exec: (program, args, options) =>
          pi.exec(program, args, {
            cwd: options.cwd,
            timeout: options.timeout,
            signal: options.signal as AbortSignal | undefined,
          }),
        plan: loaded.snapshot,
        state: loaded.state,
        runReviewer: (input) => runCompletionReviewerViaRpc(pi, input),
        runLsp: (files) => requestLsp(pi, ctx.cwd, files),
      });
      notify(
        ctx,
        formatCompletionResult(result),
        result.status === "pass" ? "info" : "warning",
      );

      let report = result.report;
      const overrideAllowed =
        result.checks.find((check) => check.name === "hard-boundaries")
          ?.status === "pass";
      if (
        !report &&
        overrideAllowed &&
        allowOverride &&
        ctx.mode === "tui" &&
        ctx.hasUI
      ) {
        const ui = ctx.ui as MutableUi;
        const reason = (
          await ui.input?.(
            "Completion-Override",
            "Nichtleere Begründung für das bewusste Restrisiko",
          )
        )?.trim();
        if (reason && loaded.snapshot)
          report = completionOverrideReport(result, loaded.snapshot, reason);
      }
      if (!report) {
        replaceState(ctx, {
          ...(reload(ctx).state as WorkflowStateV3),
          status: "blocked",
          activeStepId: undefined,
        });
        return;
      }

      const verified = reload(ctx);
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
      current = {
        stateToken: "missing",
        recovered: false,
        migrationRequired: false,
        warnings: [],
      };
      updateWorkflowPresentation(ctx);
      notify(ctx, `Plan erfolgreich archiviert: ${archivePath}`);
    } catch (error) {
      notify(ctx, `Completion abgebrochen: ${workflowWarning(error)}`, "error");
      reload(ctx);
    } finally {
      completionRunning = false;
    }
  }

  async function finishDirectTask(ctx: ExtensionContext): Promise<void> {
    if (!ctx.isProjectTrusted()) {
      notify(
        ctx,
        "Harte Trust-Grenze: Completion ist im untrusted Projekt blockiert.",
        "error",
      );
      return;
    }
    const task = loadDirectTask(ctx.cwd);
    if (!task) {
      notify(ctx, "Keine aktive direkte Aufgabe.", "warning");
      return;
    }
    if (completionRunning) return;
    completionRunning = true;
    try {
      const pipelineContext = {
        projectRoot: ctx.cwd,
        trusted: ctx.isProjectTrusted(),
        exec: (program, args, options) =>
          pi.exec(program, args, {
            cwd: options.cwd,
            timeout: options.timeout,
            signal: options.signal as AbortSignal | undefined,
          }),
        directTask: task,
        runReviewer: (input) => runCompletionReviewerViaRpc(pi, input),
        runLsp: (files) => requestLsp(pi, ctx.cwd, files),
      } satisfies Parameters<typeof runCompletionPipeline>[0];
      let result = await runCompletionPipeline(pipelineContext);
      notify(
        ctx,
        formatCompletionResult(result),
        result.status === "pass" ? "info" : "warning",
      );
      const overrideAllowed =
        result.checks.find((check) => check.name === "hard-boundaries")
          ?.status === "pass";
      if (
        !result.report &&
        overrideAllowed &&
        ctx.mode === "tui" &&
        ctx.hasUI
      ) {
        const reason = (
          await (ctx.ui as MutableUi).input?.(
            "Direct-Task-Override",
            "Nichtleere Begründung für den Abschluss trotz Befund",
          )
        )?.trim();
        if (reason) {
          result = await runCompletionPipeline(pipelineContext, {
            overrideReason: reason,
          });
          notify(
            ctx,
            `${formatCompletionResult(result)}\n\nOverride protokolliert: ${reason}`,
            "warning",
          );
        }
      }
      if (!result.report) return;
      pi.appendEntry("workflow-completion", result.report);
      clearDirectTask(ctx.cwd);
      notify(
        ctx,
        result.report.outcome === "override"
          ? "Direkte Aufgabe mit begründetem Override abgeschlossen; Bericht wurde in der Sitzung protokolliert."
          : "Direkte Aufgabe abgeschlossen; Bericht wurde in der Sitzung protokolliert.",
      );
    } catch (error) {
      notify(
        ctx,
        `Direct Task nicht abgeschlossen: ${workflowWarning(error)}`,
        "error",
      );
    } finally {
      completionRunning = false;
    }
  }

  async function finalizePlanning(ctx: ExtensionContext): Promise<void> {
    const kind = planningKind;
    if (!kind) return;
    planningKind = undefined;
    const observed = planContent(ctx.cwd);
    if (!observed) {
      notify(ctx, `${PLAN_RELATIVE_PATH} wurde nicht erstellt.`, "warning");
      return;
    }
    try {
      const finalized = finalizePlanningTurn(
        observed,
        kind,
        planningBaseContent,
      );
      const saved = finalizeObservedPlanCAS(
        ctx.cwd,
        observed,
        finalized.snapshot,
        current.stateToken,
        current.state,
      );
      current = {
        planContent: finalized.content,
        snapshot: finalized.snapshot,
        state: saved.state,
        stateToken: saved.stateToken,
        recovered: false,
        migrationRequired: false,
        warnings: [],
      };
      updateWorkflowPresentation(ctx, saved.state);
      notify(
        ctx,
        planningIsReview
          ? "Plan-Review abgeschlossen; die aktuelle Revision benötigt vor Arbeit erneut /work."
          : `PlanSnapshot v3 gespeichert. Starte die Umsetzung ausdrücklich mit /work.`,
      );
    } catch (error) {
      notify(
        ctx,
        `Plan ist noch nicht vertragskonform:\n${workflowWarning(error)}`,
        "error",
      );
    } finally {
      planningBaseContent = undefined;
      planningIsReview = false;
    }
  }

  pi.registerFlag("plan", {
    description: "Im Architekturplan-Modus starten",
    type: "boolean",
    default: false,
  });
  pi.registerCommand("plan", {
    description: "Schnell- oder Architekturplan erstellen",
    handler: async (args, ctx) => {
      const kind = await choosePlanKind(args, ctx);
      if (kind) await beginPlanning(kind, ctx);
    },
  });
  pi.registerCommand("review-plan", {
    description: "Aktuellen Plan optional vertieft prüfen",
    handler: async (_args, ctx) => beginReview(ctx),
  });
  pi.registerCommand("work", {
    description: "Bestätigten Plan ausführen oder explizit fortsetzen",
    handler: async (_args, ctx) => startWork(ctx),
  });
  pi.registerCommand("go", {
    description: "Alias für /work",
    handler: async (_args, ctx) => startWork(ctx),
  });
  pi.registerCommand("plan-todos", {
    description: "Stabile Planschritte und Sidecar-Status anzeigen",
    handler: async (_args, ctx) => {
      const loaded = reload(ctx);
      notify(
        ctx,
        loaded.snapshot && loaded.state
          ? formatPlanSteps(loaded.snapshot, loaded.state)
          : "Keine gültigen Planschritte vorhanden.",
        loaded.snapshot && loaded.state ? "info" : "warning",
      );
    },
  });
  pi.registerCommand("done", {
    description: "Planschritte manuell abschließen: /done <n> [m …]",
    handler: async (args, ctx) => {
      if (!ctx.isProjectTrusted()) {
        notify(
          ctx,
          "Harte Trust-Grenze: Fortschritt ist im untrusted Projekt blockiert.",
          "error",
        );
        return;
      }
      const loaded = reload(ctx);
      if (!loaded.snapshot || !loaded.state) {
        notify(ctx, "Kein aktiver Plan.", "warning");
        return;
      }
      const numbers = [
        ...new Set(
          args
            .split(/[\s,]+/)
            .filter(Boolean)
            .map(Number)
            .filter(Number.isSafeInteger),
        ),
      ];
      if (numbers.length === 0) {
        notify(ctx, "Verwendung: /done <n> [m …]", "warning");
        return;
      }
      let state = loaded.state;
      for (const number of numbers) {
        const step = loaded.snapshot.steps[number - 1];
        if (!step) {
          notify(ctx, `Unbekannter Planschritt: ${number}`, "warning");
          return;
        }
        state = updateExecutionStep(state, {
          stepId: step.id,
          status: "completed",
          evidence: "Manuell über /done bestätigt.",
        }).state;
      }
      replaceState(ctx, state);
      if (state.status === "reviewing") await finishWorkflow(ctx, false);
    },
  });
  pi.registerCommand("finish", {
    description:
      "Completion-Pipeline ausführen; TUI-Override nur mit Begründung",
    handler: async (_args, ctx) => finishWorkflow(ctx, true),
  });
  pi.registerCommand("discard-plan", {
    description: "Aktiven Plan und Sidecar ausdrücklich verwerfen",
    handler: async (_args, ctx) => {
      if (!ctx.isProjectTrusted()) {
        notify(
          ctx,
          "Harte Trust-Grenze: Verwerfen ist im untrusted Projekt blockiert.",
          "error",
        );
        return;
      }
      const loaded = reload(ctx);
      if (!loaded.planContent && !loaded.state) {
        notify(ctx, "Kein aktiver Workflow vorhanden.");
        return;
      }
      const confirmed = await ctx.ui.confirm(
        "Aktiven Plan verwerfen?",
        "Plan, Sidecar und unarchivierter Completion-Report werden entfernt. Diese Aktion ist nicht automatisch rückgängig.",
      );
      if (!confirmed) return;
      try {
        discardActiveWorkflow(ctx.cwd, loaded.stateToken, true);
        current = {
          stateToken: "missing",
          recovered: false,
          migrationRequired: false,
          warnings: [],
        };
        updateWorkflowPresentation(ctx);
        notify(ctx, "Aktiver Plan und Sidecar wurden entfernt.", "warning");
      } catch (error) {
        notify(ctx, workflowWarning(error), "error");
      }
    },
  });
  pi.registerCommand("task", {
    description: "Direkte Aufgabe mit Scope und Abschlusskriterien starten",
    handler: async (args, ctx) => {
      const goal = args.trim();
      if (!goal) {
        notify(ctx, "Nutzung: /task <Ziel>", "warning");
        return;
      }
      if (!ctx.isProjectTrusted()) {
        notify(
          ctx,
          "Harte Trust-Grenze: Direct Tasks sind im untrusted Projekt blockiert.",
          "error",
        );
        return;
      }
      if (reload(ctx).planContent) {
        notify(
          ctx,
          "Ein Plan ist aktiv. Schließe ihn ab oder verwirf ihn ausdrücklich mit /discard-plan.",
          "warning",
        );
        return;
      }
      if (ctx.mode !== "tui" || !ctx.hasUI) {
        notify(
          ctx,
          "Direct Tasks benötigen TUI-Eingaben für Scope, Verifikation und Abschlusskriterien.",
          "warning",
        );
        return;
      }
      const ui = ctx.ui as MutableUi;
      const scope =
        (
          await ui.input?.(
            "Technischer Scope",
            "Projekt-relative Pfade/Globs, durch Komma getrennt",
          )
        )
          ?.split(",")
          .map((entry) => entry.trim())
          .filter(Boolean) ?? [];
      const verification =
        (
          await ui.input?.(
            "Verifikation",
            ".pi/verify.json-Profil-IDs, durch Komma getrennt",
          )
        )
          ?.split(",")
          .map((entry) => entry.trim())
          .filter(Boolean) ?? [];
      const acceptanceCriteria =
        (
          await ui.input?.(
            "Abschlusskriterien",
            "Beobachtbare Kriterien, durch Komma getrennt",
          )
        )
          ?.split(",")
          .map((entry) => entry.trim())
          .filter(Boolean) ?? [];
      if (
        scope.length === 0 ||
        verification.length === 0 ||
        acceptanceCriteria.length === 0
      ) {
        notify(
          ctx,
          "Direct Task nicht erstellt: alle drei Felder sind erforderlich.",
          "warning",
        );
        return;
      }
      const existing = loadDirectTask(ctx.cwd);
      if (
        existing &&
        !(await ctx.ui.confirm(
          "Direct Task überschreiben?",
          `Aktiv: ${existing.goal}`,
        ))
      ) {
        return;
      }
      const task = saveDirectTask(ctx.cwd, {
        goal,
        technicalScope: scope,
        verification,
        acceptanceCriteria,
      });
      pi.sendMessage(
        {
          customType: "pi-direct-task",
          content: `Führe die direkte Aufgabe aus. Bleibe im technischen Scope und prüfe die Abschlusskriterien. Nutze /task-done zum Abschluss.\n\n${JSON.stringify(task, null, 2)}`,
          display: true,
        },
        { triggerTurn: true },
      );
    },
  });
  pi.registerCommand("task-done", {
    description: "Direct Task über dieselbe Completion-Pipeline abschließen",
    handler: async (_args, ctx) => finishDirectTask(ctx),
  });
  pi.registerCommand("migrate-plan", {
    description: "Legacy-Workflow v1/v2 ausdrücklich nach v3 migrieren",
    handler: async (_args, ctx) => {
      if (!ctx.isProjectTrusted()) {
        notify(
          ctx,
          "Harte Trust-Grenze: Migration ist im untrusted Projekt blockiert.",
          "error",
        );
        return;
      }
      const confirmed = await ctx.ui.confirm(
        "Legacy-Workflow migrieren?",
        "Bestätige nur, wenn alle älteren Pi-Sessions für dieses Projekt geschlossen sind. Vorher wird ein Backup angelegt.",
      );
      if (!confirmed) return;
      try {
        current = migrateLegacyWorkflowToV3(ctx.cwd, {
          confirmedLegacySessionsClosed: true,
        });
        updateWorkflowPresentation(ctx, current.state);
        notify(ctx, current.warnings.join("\n"));
      } catch (error) {
        notify(ctx, workflowWarning(error), "error");
      }
    },
  });
  pi.registerCommand("recover-workflow-lock", {
    description: "Verwaisten Workflow-Lock nach Bestätigung entfernen",
    handler: async (_args, ctx) => {
      if (!ctx.isProjectTrusted()) {
        notify(
          ctx,
          "Harte Trust-Grenze: Lock-Recovery ist im untrusted Projekt blockiert.",
          "error",
        );
        return;
      }
      const confirmed = await ctx.ui.confirm(
        "Workflow-Lock entfernen?",
        "Nur bestätigen, wenn kein anderer Pi-Prozess diesen Workflow bearbeitet.",
      );
      if (!confirmed) return;
      try {
        clearWorkflowLockAfterConfirmation(ctx.cwd, true);
        notify(ctx, "Workflow-Lock entfernt.");
      } catch (error) {
        notify(ctx, workflowWarning(error), "error");
      }
    },
  });

  pi.registerTool({
    name: "plan_progress",
    label: "Plan Progress",
    description:
      "Schreibt ausschließlich Fortschritt zu einer stabilen Step-ID in den v3-Sidecar.",
    parameters: PlanProgressParams,
    executionMode: "sequential",
    async execute(_id, params, _signal, _onUpdate, ctx) {
      try {
        if (!ctx.isProjectTrusted()) {
          return textResult(
            "Fehler: Harte Trust-Grenze blockiert Fortschritt im untrusted Projekt.",
            { ok: false },
          );
        }
        const loaded = reload(ctx);
        if (!loaded.state || !loaded.snapshot) {
          return textResult("Fehler: Kein aktiver PlanSnapshot.", {
            ok: false,
          });
        }
        const updated = updateExecutionStep(loaded.state, {
          stepId: params.stepId,
          status: params.status,
          evidence: params.evidence,
        });
        replaceState(ctx, updated.state);
        return textResult(
          updated.allCompleted
            ? `T${updated.stepNumber} abgeschlossen; alle Schritte sind bereit für Completion.`
            : `T${updated.stepNumber} ist jetzt ${params.status}.`,
          {
            ok: true,
            stepId: params.stepId,
            status: params.status,
            allCompleted: updated.allCompleted,
          },
        );
      } catch (error) {
        return textResult(`Fehler: ${workflowWarning(error)}`, { ok: false });
      }
    },
  });

  /**
   * Model control (Super+M and the Hauptmenü "Modelle" entry).
   *
   * Lists what the registry actually offers and applies the choice through
   * pi.setModel. The retired scoped-model overlay is NOT restored here.
   */
  async function openModelMenu(ctx: ExtensionContext): Promise<void> {
    // Never swap the model out from under a running turn.
    if (typeof ctx.isIdle === "function" && !ctx.isIdle()) {
      ctx.ui.notify(
        "Der Agent arbeitet gerade. Ein Modellwechsel ist erst danach möglich.",
        "warning",
      );
      return;
    }
    const available = [...ctx.modelRegistry.getAvailable()].sort(
      (left, right) =>
        `${left.provider}/${left.id}`.localeCompare(
          `${right.provider}/${right.id}`,
        ),
    );
    if (available.length === 0) {
      ctx.ui.notify("Keine Modelle verfügbar.", "warning");
      return;
    }
    const current = ctx.model
      ? `${ctx.model.provider}/${ctx.model.id}`
      : undefined;
    const labels = available.map((model) => {
      const reference = `${model.provider}/${model.id}`;
      return reference === current ? `● ${reference}` : `  ${reference}`;
    });
    const choice = await ctx.ui.select("Modell wählen", labels);
    if (!choice) return;
    const picked = available.find((model) =>
      choice.endsWith(`${model.provider}/${model.id}`),
    );
    if (picked) pi.setModel(picked);
  }

  pi.registerShortcut(SHORTCUTS.modelMenu.keys, {
    description: SHORTCUTS.modelMenu.description,
    handler: async (ctx) => await openModelMenu(ctx),
  });
  // Without this listener the Hauptmenü "Modelle" entry emitted into the void.
  pi.events.on(CONTROL_CENTER_EVENTS.openModels, async (event) => {
    const ctx = (event as { ctx?: ExtensionContext }).ctx;
    if (ctx) await openModelMenu(ctx);
  });

  pi.registerShortcut(SHORTCUTS.planAssistant.keys, {
    description: SHORTCUTS.planAssistant.description,
    handler: async (ctx) => {
      const kind = await choosePlanKind("", ctx);
      if (kind) await beginPlanning(kind, ctx);
    },
  });
  pi.registerShortcut(SHORTCUTS.modeMenu.keys, {
    description: SHORTCUTS.modeMenu.description,
    handler: async (ctx) => {
      const choice = await ctx.ui.select("Control Center", [
        "Schnellplan",
        "Architekturplan",
        "Arbeiten / fortsetzen",
        "Berechtigungen",
        "Modelle",
        "Thinking",
        "LSP-Diagnose",
      ]);
      if (choice === "Schnellplan") await beginPlanning("simple_plan", ctx);
      else if (choice === "Architekturplan")
        await beginPlanning("detailed_plan", ctx);
      else if (choice === "Arbeiten / fortsetzen") await startWork(ctx);
      else if (choice === "Berechtigungen")
        pi.events.emit(CONTROL_CENTER_EVENTS.openPermissions, { ctx });
      else if (choice === "Modelle")
        pi.events.emit(CONTROL_CENTER_EVENTS.openModels, { ctx });
      else if (choice === "Thinking")
        pi.events.emit(CONTROL_CENTER_EVENTS.openThinking, { ctx });
      else if (choice === "LSP-Diagnose")
        pi.events.emit(CONTROL_CENTER_EVENTS.openDiagnostics, { ctx });
    },
  });

  pi.events.on(WORKFLOW_CAPABILITY_EVENTS.request, (value) => {
    const request = value as Partial<WorkflowCapabilityRequest>;
    if (typeof request.respond !== "function") return;
    request.respond({
      state: planningKind
        ? planningIsReview
          ? "reviewing"
          : "planning"
        : (current.state?.status ?? "idle"),
      mode: workflowMode(),
    });
  });
  pi.events.on(CONTROL_CENTER_EVENTS.workflowThinkingDefault, (value) => {
    const event = value as {
      respond?: (result: { mode: string; defaultLevel: string }) => void;
    };
    event.respond?.({
      mode:
        planningKind ?? (current.state?.status === "working" ? "work" : "idle"),
      defaultLevel: planningKind === "detailed_plan" ? "high" : "medium",
    });
  });

  pi.on("before_agent_start", async (_event, ctx) => {
    if (planningKind)
      return {
        message: {
          customType: "pi-plan-context",
          content:
            planningIsReview && current.planContent
              ? reviewPrompt(current.planContent)
              : planningPrompt(planningKind),
        } as AgentMessage,
      };
    const loaded = reload(ctx);
    if (loaded.snapshot && loaded.state?.status === "working") {
      return {
        message: {
          customType: "pi-work-context",
          content: executionPrompt(loaded.snapshot, loaded.state),
        } as AgentMessage,
      };
    }
    const directTask = loadDirectTask(ctx.cwd);
    if (directTask) {
      return {
        message: {
          customType: "pi-direct-task-context",
          content: `Aktive direkte Aufgabe:\n${JSON.stringify(directTask, null, 2)}`,
        } as AgentMessage,
      };
    }
    return undefined;
  });

  pi.on("agent_settled", async (_event, ctx) => {
    if (planningKind) {
      await finalizePlanning(ctx);
      return;
    }
    const loaded = reload(ctx);
    if (
      loaded.state?.status === "reviewing" &&
      loaded.state.steps.length > 0 &&
      loaded.state.steps.every((step) => step.status === "completed")
    ) {
      await finishWorkflow(ctx, false);
    }
  });

  pi.on("session_start", async (_event, ctx) => {
    activeCwd = ctx.cwd;
    activeContext = ctx;
    planningKind = pi.getFlag("plan") === true ? "detailed_plan" : undefined;
    planningBaseContent = undefined;
    planningIsReview = false;
    try {
      const loaded = reload(ctx);
      for (const warning of loaded.warnings) notify(ctx, warning, "warning");
      if (loaded.migrationRequired) {
        notify(
          ctx,
          "Legacy-Workflow erkannt. Schließe alte Sessions und nutze /migrate-plan.",
          "warning",
        );
      } else if (loaded.state?.status === "working") {
        notify(
          ctx,
          "Unterbrochene Ausführung erkannt. Es gibt keine zeitgesteuerte Übernahme; nutze /work für explizite Recovery.",
          "warning",
        );
      }
    } catch (error) {
      notify(
        ctx,
        `Workflow-State nicht sicher geladen: ${workflowWarning(error)}`,
        "error",
      );
    }
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    if (
      activeCwd === ctx.cwd &&
      ctx.isProjectTrusted() &&
      current.state?.status === "working"
    ) {
      try {
        replaceState(ctx, pauseExecution(current.state));
      } catch (error) {
        notify(
          ctx,
          `Pause-State nicht gespeichert: ${workflowWarning(error)}`,
          "warning",
        );
      }
    }
    activeCwd = undefined;
    activeContext = undefined;
    planningKind = undefined;
    clearWorkflowPresentation(ctx);
  });

  void activeContext;
}
