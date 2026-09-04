import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { catalogDescription } from "../shared/command-catalog.ts";
import { buildWorkflowEntries } from "../shared/control-center-menu.ts";
import {
  WORKFLOW_MODES,
  isPlanningMode,
  type WorkflowMode,
} from "../shared/workflow-mode.ts";
import {
  editPlanMarkdown,
  savePlanToWorkspace,
  viewPlanMarkdown,
} from "./plan-editor.ts";
import { readPlan } from "./plan-store.ts";
import type { WorkflowSession } from "./session.ts";
import { openCommandCenter } from "./command-center.ts";

/**
 * The prompt an approval starts.
 *
 * The grant is bound to this exact text (see `WorkflowSession.approve`), which
 * is what stops any other turn — a follow-up question, a review request, a
 * "what did you mean by step 3" — from silently spending it.
 */
export const PLAN_EXECUTION_PROMPT =
  "Setze den freigegebenen Plan um.";

export function planExecutionPrompt(addition?: string): string {
  const extra = addition?.trim();
  return extra ? `${PLAN_EXECUTION_PROMPT} ${extra}` : PLAN_EXECUTION_PROMPT;
}

export async function switchMode(
  session: WorkflowSession,
  mode: WorkflowMode,
  ctx: ExtensionContext,
): Promise<boolean> {
  if (isPlanningMode(mode)) {
    if (!ctx.isProjectTrusted()) {
      session.notify(
        ctx,
        "Harte Trust-Grenze: Planmodus ist im untrusted Projekt blockiert.",
        "error",
      );
      return false;
    }
    // Choosing a plan mode means the next planning turn will replace the plan,
    // so nothing that was ready or approved before may survive it.
    session.clearApproval();
    session.clearReadiness();
  }
  session.requestMode(ctx, mode);
  return true;
}

type PlanDecision = "execute" | "keep-planning" | "work-without-execution";

/**
 * The decision a finished plan requires.
 *
 * Switching to work used to *be* the approval, which meant the user could not
 * leave plan mode without arming an execution they may not have wanted. The
 * three outcomes are now separate and named.
 */
export async function decidePlan(
  session: WorkflowSession,
  ctx: ExtensionContext,
): Promise<void> {
  const ready = session.readiness();
  if (!ready) {
    session.notify(
      ctx,
      "Es liegt kein abgeschlossener Plan dieser Sitzung vor, über den zu entscheiden wäre.",
      "info",
    );
    return;
  }
  const quality = ready.qualityOk
    ? ""
    : " (Achtung: Der Plan erfüllt die Mindestanforderungen seines Modus nicht.)";
  const entries: { label: string; value: PlanDecision }[] = [
    { label: `Plan ausführen — startet einen Work-Turn${quality}`, value: "execute" },
    { label: "Weiter planen — im Planmodus bleiben", value: "keep-planning" },
    {
      label: "Ohne Ausführung nach Work wechseln",
      value: "work-without-execution",
    },
  ];
  const choice = await ctx.ui.select(
    "Fertiger Plan",
    entries.map((entry) => entry.label),
  );
  const decision = entries.find((entry) => entry.label === choice)?.value;
  if (!decision) return;
  if (decision === "keep-planning") return;
  if (decision === "work-without-execution") {
    // Explicitly *not* an approval: no grant is armed, so the next work turn
    // carries no plan at all.
    session.clearApproval();
    session.clearReadiness();
    await switchMode(session, "work", ctx);
    session.notify(
      ctx,
      "Work aktiv. Der Plan bleibt gespeichert, wird aber nicht ausgeführt (/plan-approve gibt ihn später frei).",
    );
    return;
  }
  await approvePlan(session, ctx);
}

/**
 * The explicit approval.
 *
 * It binds the grant to the plan's current hash and to the one prompt it
 * starts, leaves the permission level exactly as it was, and starts a single
 * ordinary work turn — every guard, the recovery gate and the trust boundary
 * still apply to it.
 */
export async function approvePlan(
  session: WorkflowSession,
  ctx: ExtensionContext,
): Promise<void> {
  // The runtime dispatches commands and shortcuts without an idle gate (the
  // same TOCTOU class the turn-pinned mode elsewhere in this module closes),
  // so this can be reached while a turn — including the very planning turn
  // that produced this plan — is still running. This first check turns away
  // the common case immediately, before asking the operator anything.
  if (!ctx.isIdle()) {
    session.notify(
      ctx,
      "Ein Turn läuft noch. Warte, bis er abgeschlossen ist, und gib den Plan danach frei.",
      "warning",
    );
    return;
  }
  const stored = readPlan(session.location(ctx));
  if (!stored) {
    session.notify(
      ctx,
      "Kein Plan dieser Sitzung vorhanden. Erstelle zuerst einen Plan im Planmodus.",
      "warning",
    );
    return;
  }
  const ready = session.readiness();
  if (ready && ready.hash !== stored.hash) {
    session.notify(
      ctx,
      "Der Plan hat sich seit dem letzten Planning-Turn geändert. Sieh ihn mit /view-plan an und gib ihn danach erneut frei.",
      "warning",
    );
    return;
  }
  // `plan_write` blocks the agent from ever saving a plan that fails its
  // mode's gate — that is the mechanically enforced part. What reaches here
  // can still fail it: a human edit through the external editor never goes
  // through plan_write at all, and readiness itself can be absent (e.g. a
  // kept-but-unreviewed plan after a failed turn, see settleTurn). Neither
  // case may execute silently, so anything short of a positive pass requires
  // an explicit, separately worded confirmation and is recorded as such.
  const qualityOverride = ready?.qualityOk !== true;
  if (qualityOverride) {
    const confirmed = await ctx.ui.confirm(
      "Ungeprüfter Plan",
      "Dieser Plan erfüllt die Mindestanforderungen seines Modus nicht oder wurde nicht durch die Planungsprüfung erzeugt (z. B. eine manuelle Bearbeitung). Trotzdem als bewusster Override freigeben?",
    );
    if (!confirmed) return;
  }
  const addition = await ctx.ui.input(
    "Plan ausführen",
    "Optionaler Zusatzauftrag für diesen Turn (leer lassen für den Plan wie er ist)",
  );
  // The two dialogs above each wait on the operator and can take arbitrarily
  // long — that is the real TOCTOU window, not the synchronous code below.
  // Re-checking idle here, immediately before the first mutation, is what
  // actually closes it: nothing between this line and `sendUserMessage`
  // awaits anything that yields back to a state a concurrent turn could
  // change (`switchMode` below performs no I/O and no real await of its own).
  if (!ctx.isIdle()) {
    session.notify(
      ctx,
      "Ein Turn läuft inzwischen. Warte, bis er abgeschlossen ist, und gib den Plan danach frei.",
      "warning",
    );
    return;
  }
  const prompt = planExecutionPrompt(
    typeof addition === "string" ? addition : undefined,
  );
  session.approve({
    hash: stored.hash,
    prompt,
    sessionId: ctx.sessionManager.getSessionId(),
    approvedAt: new Date().toISOString(),
  });
  session.clearReadiness();
  await switchMode(session, "work", ctx);
  session.pi.appendEntry("plan-approval", {
    timestamp: new Date().toISOString(),
    hash: stored.hash,
    bytes: Buffer.byteLength(stored.content, "utf8"),
    qualityOverride,
  });
  session.notify(
    ctx,
    qualityOverride
      ? "Plan als Override freigegeben (Mindestanforderungen nicht bestätigt). Die Zugriffsstufe bleibt unverändert; alle Sicherheits- und Recovery-Gates gelten weiter."
      : "Plan freigegeben. Die Zugriffsstufe bleibt unverändert; alle Sicherheits- und Recovery-Gates gelten weiter.",
  );
  session.pi.sendUserMessage(prompt);
}

export async function openWorkflowMenu(
  session: WorkflowSession,
  ctx: ExtensionContext,
): Promise<void> {
  const ready = session.readiness();
  const entries = buildWorkflowEntries(session.selectedMode, Boolean(ready));
  const choice = await ctx.ui.select(
    "Workflow wechseln",
    entries.map((entry) => entry.label),
  );
  const action = entries.find((entry) => entry.label === choice)?.value;
  if (!action) return;
  if (action === "plan-decide") {
    await decidePlan(session, ctx);
    return;
  }
  // Selecting a mode changes context but leaves the editor idle, so the next
  // turn can still only come from a real user prompt.
  await switchMode(session, action, ctx);
}

export function registerPlanCommands(
  pi: ExtensionAPI,
  session: WorkflowSession,
): void {
  let workflowMenuOpen = false;
  pi.registerShortcut("shift+tab", {
    description: "Workflow wechseln",
    handler: async (ctx: ExtensionContext) => {
      if (workflowMenuOpen) return;
      workflowMenuOpen = true;
      try {
        await openWorkflowMenu(session, ctx);
      } catch (error) {
        session.notify(
          ctx,
          `Workflow-Auswahl fehlgeschlagen: ${
            error instanceof Error ? error.message : String(error)
          }`,
          "error",
        );
      } finally {
        workflowMenuOpen = false;
      }
    },
  });
  pi.registerCommand("view-plan", {
    description: catalogDescription("view-plan"),
    handler: async (_args, ctx) => viewPlanMarkdown(session, ctx),
  });
  pi.registerCommand("show-plan", {
    description: "Alias für /view-plan",
    handler: async (_args, ctx) => viewPlanMarkdown(session, ctx),
  });

  const editPlan = async (ctx: ExtensionContext, name: string) => {
    if (!isPlanningMode(session.selectedMode)) {
      session.notify(ctx, `/${name} ist nur im Planmodus verfügbar.`, "warning");
      return;
    }
    await editPlanMarkdown(session, ctx);
  };
  pi.registerCommand("edit-plan", {
    description: catalogDescription("edit-plan"),
    handler: async (_args, ctx) => editPlan(ctx, "edit-plan"),
  });
  pi.registerCommand("plan-edit", {
    description: "Alias für /edit-plan",
    handler: async (_args, ctx) => editPlan(ctx, "plan-edit"),
  });

  pi.registerCommand("plan-decide", {
    description: catalogDescription("plan-decide"),
    handler: async (_args, ctx) => decidePlan(session, ctx),
  });
  pi.registerCommand("plan-approve", {
    description: catalogDescription("plan-approve"),
    handler: async (_args, ctx) => approvePlan(session, ctx),
  });
  // Named `save-plan`, like `view-plan` and `edit-plan`: the `/plan-…` form is
  // reserved for the workflow actions that Shift+Tab owns.
  pi.registerCommand("save-plan", {
    description: catalogDescription("save-plan"),
    handler: async (_args, ctx) => savePlanToWorkspace(session, ctx),
  });

  pi.registerCommand("commands", {
    description: catalogDescription("commands"),
    handler: async (_args, ctx) =>
      openCommandCenter(pi, ctx, { activeMode: session.selectedMode }),
  });

  pi.registerCommand("workflow-set", {
    description: catalogDescription("workflow-set"),
    handler: async (args, ctx) => {
      const requested = args.trim().toLowerCase();
      const mode = WORKFLOW_MODES.find((m) => m === requested);
      if (!mode) {
        session.notify(
          ctx,
          `Unbekannter Workflow-Modus: ${requested}. Erlaubt: ${WORKFLOW_MODES.join(", ")}`,
          "error",
        );
        return;
      }
      await switchMode(session, mode, ctx);
    },
  });
}
