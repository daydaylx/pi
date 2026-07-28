import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PlanSnapshot } from "./plan-snapshot.ts";
import type { WorkflowSession } from "./session.ts";
import type {
  WorkflowStateV3,
  WorkflowStepState,
  WorkflowStepStatus,
} from "./store/index.ts";
import { routingInputFromPlan } from "./routing/index.ts";

export interface StepUpdate {
  stepId: string;
  status: Exclude<WorkflowStepStatus, "pending">;
  evidence: string;
}

export interface StepUpdateResult {
  state: WorkflowStateV3;
  allCompleted: boolean;
  stepNumber: number;
}

export function startOrResumeExecution(
  state: WorkflowStateV3,
): WorkflowStateV3 {
  if (state.status === "done") {
    throw new Error(
      "Ein abgeschlossener Workflow kann nicht fortgesetzt werden.",
    );
  }
  return {
    ...state,
    status: "working",
    reviewedPlanHash: undefined,
    completion: undefined,
  };
}

export function pauseExecution(state: WorkflowStateV3): WorkflowStateV3 {
  return {
    ...state,
    status: "paused",
    activeStepId: undefined,
    steps: state.steps.map((step) =>
      step.status === "in_progress"
        ? { ...step, status: "pending" as const, evidence: undefined }
        : step,
    ),
  };
}

export function updateExecutionStep(
  state: WorkflowStateV3,
  update: StepUpdate,
): StepUpdateResult {
  if (state.status !== "working" && state.status !== "blocked") {
    throw new Error("Fortschritt ist nur in working oder blocked zulässig.");
  }
  const evidence = update.evidence.trim();
  if (!evidence) throw new Error("Ein konkreter Nachweis ist erforderlich.");
  if (evidence.length > 1000) {
    throw new Error("Der Nachweis darf höchstens 1000 Zeichen enthalten.");
  }
  const index = state.steps.findIndex((step) => step.id === update.stepId);
  if (index < 0) throw new Error("Unbekannte oder veraltete Step-ID.");
  const current = state.steps[index] as WorkflowStepState;
  if (current.status === "completed" && update.status !== "completed") {
    throw new Error("Ein abgeschlossener Schritt wird nicht zurückgesetzt.");
  }
  const active = state.steps.find(
    (step) => step.status === "in_progress" && step.id !== update.stepId,
  );
  if (update.status === "in_progress" && active) {
    throw new Error(`Ein anderer Schritt ist bereits in Arbeit: ${active.id}`);
  }
  const steps = state.steps.map((step) =>
    step.id === update.stepId
      ? { ...step, status: update.status, evidence }
      : step,
  );
  const allCompleted =
    steps.length > 0 && steps.every((step) => step.status === "completed");
  return {
    state: {
      ...state,
      status:
        update.status === "blocked"
          ? "blocked"
          : allCompleted
            ? "reviewing"
            : "working",
      activeStepId: update.status === "in_progress" ? update.stepId : undefined,
      steps,
    },
    allCompleted,
    stepNumber: index + 1,
  };
}

/**
 * Resolve 1-based plan step numbers against the snapshot and complete them.
 *
 * Pure: the caller persists the result. An unknown number aborts the whole
 * batch rather than completing a prefix of it, so a typo cannot silently mark
 * the wrong steps as done.
 */
export function completeStepsByNumber(
  snapshot: PlanSnapshot,
  state: WorkflowStateV3,
  numbers: readonly number[],
  evidence = "Manuell über /done bestätigt.",
): { state: WorkflowStateV3 } | { unknownStep: number } {
  let next = state;
  for (const number of numbers) {
    const step = snapshot.steps[number - 1];
    if (!step) return { unknownStep: number };
    next = updateExecutionStep(next, {
      stepId: step.id,
      status: "completed",
      evidence,
    }).state;
  }
  return { state: next };
}

/** Parse "/done 1, 2 3" into unique, safe step numbers. */
export function parseStepNumbers(args: string): number[] {
  return [
    ...new Set(
      args
        .split(/[\s,]+/)
        .filter(Boolean)
        .map(Number)
        .filter(Number.isSafeInteger),
    ),
  ];
}

export function executionPrompt(
  snapshot: PlanSnapshot,
  state: WorkflowStateV3,
): string {
  const status = new Map(state.steps.map((step) => [step.id, step.status]));
  const steps = snapshot.steps
    .map(
      (step, index) =>
        `${index + 1}. [${status.get(step.id) ?? "pending"}] ${step.text}\n   Step-ID: ${step.id}`,
    )
    .join("\n");
  return `[PI WORKFLOW: AUSFÜHRUNG]
Führe den verbindlichen PlanSnapshot aus. Ändere den Plan während der Ausführung
nicht. Fortschritt gehört ausschließlich in den Sidecar und wird mit dem Tool
plan_progress anhand der stabilen Step-ID gemeldet.

Regeln:
- Vor Arbeit an einem Schritt: status=in_progress mit kurzem Nachweis.
- completed erst nach überprüfbarem Ergebnis.
- blocked mit konkreter Ursache.
- Scope, Änderungsregeln, Nicht-Ziele und Abschlusskriterien sind bindend.
- Keine Commits, Pushes oder Dependency-Installationen ohne Nutzerauftrag.

Plan:
${snapshot.content}

Aktueller Schrittstatus:
${steps}`;
}

export async function startWork(
  session: WorkflowSession,
  ctx: ExtensionContext,
): Promise<void> {
  if (!ctx.isProjectTrusted()) {
    session.notify(
      ctx,
      "Harte Trust-Grenze: /work ist im untrusted Projekt blockiert.",
      "error",
    );
    return;
  }
  const loaded = session.reload(ctx);
  if (loaded.migrationRequired) {
    session.notify(
      ctx,
      "Legacy-State zuerst ausdrücklich mit /migrate-plan migrieren.",
      "warning",
    );
    return;
  }
  if (!loaded.snapshot || !loaded.state) {
    session.notify(
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
  session.replaceState(ctx, startOrResumeExecution(loaded.state));
  session.assessRouting(ctx, routingInputFromPlan(loaded.snapshot));
  session.publishWorkflowActivation(ctx);
  session.pi.sendMessage(
    {
      customType: "pi-work-request",
      content: "Führe jetzt den verbindlichen PlanSnapshot aus.",
      display: true,
    },
    { triggerTurn: true },
  );
}
