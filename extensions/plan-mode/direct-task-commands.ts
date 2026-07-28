/**
 * /task: create a direct task without a plan.
 *
 * Direct tasks stay deliberately separate from the plan workflow — they have
 * their own scope contract — but they share the completion pipeline, so there
 * is no second verification path. Creation is TUI-only because the three
 * contract fields must be stated by the user, never inferred.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { activateWorkMode } from "./execution.ts";
import { promptInput } from "./presentation.ts";
import type { WorkflowSession } from "./session.ts";
import {
  loadDirectTask,
  saveDirectTask,
  type DirectTask,
} from "./store/index.ts";
import { routingInputFromDirectTask } from "./routing/index.ts";

function commaList(value: string | undefined): string[] {
  return (
    value
      ?.split(",")
      .map((entry) => entry.trim())
      .filter(Boolean) ?? []
  );
}

/**
 * Whether a direct task may be started at all.
 *
 * An active plan wins: a direct task alongside it would give the completion
 * pipeline two competing scope contracts.
 */
export function checkDirectTaskEligibility(
  session: WorkflowSession,
  ctx: ExtensionContext,
): { ok: true } | { ok: false; message: string; level: "warning" | "error" } {
  if (!ctx.isProjectTrusted()) {
    return {
      ok: false,
      level: "error",
      message:
        "Harte Trust-Grenze: Direktaufträge sind im untrusted Projekt blockiert.",
    };
  }
  if (session.reload(ctx).planContent) {
    return {
      ok: false,
      level: "warning",
      message:
        "Ein Plan ist aktiv. Schließe ihn ab oder verwirf ihn ausdrücklich mit /discard-plan.",
    };
  }
  if (ctx.mode !== "tui" || !ctx.hasUI) {
    return {
      ok: false,
      level: "warning",
      message:
        "Direktaufträge benötigen TUI-Eingaben für Scope, Verifikation und Abschlusskriterien.",
    };
  }
  return { ok: true };
}

/** Start a direct task from the workflow menu, including its goal prompt. */
export async function beginDirectTask(
  session: WorkflowSession,
  ctx: ExtensionContext,
): Promise<void> {
  const eligibility = checkDirectTaskEligibility(session, ctx);
  if (!eligibility.ok) {
    session.notify(ctx, eligibility.message, eligibility.level);
    return;
  }
  const goal = (
    await promptInput(
      ctx,
      "Direktauftrag starten",
      "Ziel der überschaubaren Änderung",
    )
  )?.trim();
  if (!goal) return;
  await startDirectTask(session, ctx, goal);
}

function startDirectTaskExecution(
  session: WorkflowSession,
  ctx: ExtensionContext,
  task: DirectTask,
): void {
  activateWorkMode(session, ctx);
  session.assessRouting(ctx, routingInputFromDirectTask(task));
  session.publishWorkflowActivation(ctx);
  session.pi.sendMessage(
    {
      customType: "pi-direct-task",
      content: `Führe den Direktauftrag aus. Bleibe im technischen Scope und prüfe die Abschlusskriterien. Nutze /task-done zum Abschluss.\n\n${JSON.stringify(task, null, 2)}`,
      display: true,
    },
    { triggerTurn: true },
  );
}

/** Resume a stored direct task through the same explicit handoff as a new one. */
export async function resumeDirectTask(
  session: WorkflowSession,
  ctx: ExtensionContext,
): Promise<void> {
  if (!ctx.isProjectTrusted()) {
    session.notify(
      ctx,
      "Harte Trust-Grenze: Direktaufträge sind im untrusted Projekt blockiert.",
      "error",
    );
    return;
  }
  const loaded = session.reload(ctx);
  if (loaded.planContent) {
    session.notify(
      ctx,
      "Ein Plan ist aktiv. Schließe ihn ab oder verwirf ihn ausdrücklich mit /discard-plan.",
      "warning",
    );
    return;
  }
  const task = loadDirectTask(ctx.cwd);
  if (!task) {
    session.notify(ctx, "Kein aktiver Direktauftrag.", "warning");
    return;
  }
  startDirectTaskExecution(session, ctx, task);
}

export async function startDirectTask(
  session: WorkflowSession,
  ctx: ExtensionContext,
  args: string,
): Promise<void> {
  const goal = args.trim();
  if (!goal) {
    session.notify(ctx, "Nutzung: /task <Ziel>", "warning");
    return;
  }
  const eligibility = checkDirectTaskEligibility(session, ctx);
  if (!eligibility.ok) {
    session.notify(ctx, eligibility.message, eligibility.level);
    return;
  }

  const technicalScope = commaList(
    await promptInput(
      ctx,
      "Technischer Scope",
      "Projekt-relative Pfade/Globs, durch Komma getrennt",
    ),
  );
  const verification = commaList(
    await promptInput(
      ctx,
      "Verifikation",
      ".pi/verify.json-Profil-IDs, durch Komma getrennt",
    ),
  );
  const acceptanceCriteria = commaList(
    await promptInput(
      ctx,
      "Abschlusskriterien",
      "Beobachtbare Kriterien, durch Komma getrennt",
    ),
  );
  if (
    technicalScope.length === 0 ||
    verification.length === 0 ||
    acceptanceCriteria.length === 0
  ) {
    session.notify(
      ctx,
      "Direktauftrag nicht erstellt: alle drei Felder sind erforderlich.",
      "warning",
    );
    return;
  }

  const existing = loadDirectTask(ctx.cwd);
  if (
    existing &&
    !(await ctx.ui.confirm(
      "Direktauftrag überschreiben?",
      `Aktiv: ${existing.goal}`,
    ))
  ) {
    return;
  }
  const task = saveDirectTask(ctx.cwd, {
    goal,
    technicalScope,
    verification,
    acceptanceCriteria,
  });
  startDirectTaskExecution(session, ctx, task);
}
