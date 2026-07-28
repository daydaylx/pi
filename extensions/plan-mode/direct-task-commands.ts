/**
 * /task: create a direct task without a plan.
 *
 * Direct tasks stay deliberately separate from the plan workflow — they have
 * their own scope contract — but they share the completion pipeline, so there
 * is no second verification path. Creation is TUI-only because the three
 * contract fields must be stated by the user, never inferred.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { promptInput } from "./presentation.ts";
import type { WorkflowSession } from "./session.ts";
import { loadDirectTask, saveDirectTask } from "./store/index.ts";

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
        "Harte Trust-Grenze: Direct Tasks sind im untrusted Projekt blockiert.",
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
        "Direct Tasks benötigen TUI-Eingaben für Scope, Verifikation und Abschlusskriterien.",
    };
  }
  return { ok: true };
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
    technicalScope,
    verification,
    acceptanceCriteria,
  });
  session.pi.sendMessage(
    {
      customType: "pi-direct-task",
      content: `Führe die direkte Aufgabe aus. Bleibe im technischen Scope und prüfe die Abschlusskriterien. Nutze /task-done zum Abschluss.\n\n${JSON.stringify(task, null, 2)}`,
      display: true,
    },
    { triggerTurn: true },
  );
}
