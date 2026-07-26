/** Fail-open, model-free checkpoint of plan artifacts into the context ledger. */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  consolidateLedger,
  CONTEXT_LEDGER_RELATIVE_PATH,
  type LedgerTrigger,
} from "../shared/context-ledger.ts";
import { extractTodoItems, readDecisionBrief, readPlanFile } from "./utils.ts";

function projectName(cwd: string): string {
  const parts = cwd.split(/[\\/]+/).filter(Boolean);
  return parts.at(-1) || "Projekt";
}

export function runLedgerCheckpoint(
  ctx: ExtensionContext,
  trigger: LedgerTrigger,
): void {
  try {
    if (!ctx.isProjectTrusted()) return;
    let briefContent: string | undefined;
    let planContent: string | undefined;
    let openPriorities: string[] = [];
    try {
      briefContent = readDecisionBrief(ctx.cwd);
    } catch {
      // A corrupt brief must not prevent the remaining checkpoint.
    }
    try {
      planContent = readPlanFile(ctx.cwd);
    } catch {
      // A corrupt plan must not prevent the remaining checkpoint.
    }
    try {
      openPriorities = planContent
        ? extractTodoItems(planContent)
            .filter((todo) => !todo.completed)
            .map((todo) => todo.text)
        : [];
    } catch {
      openPriorities = [];
    }
    if (
      briefContent === undefined &&
      planContent === undefined &&
      openPriorities.length === 0
    ) {
      return;
    }
    if (
      consolidateLedger(
        ctx.cwd,
        projectName(ctx.cwd),
        { briefContent, planContent, openPriorities },
        trigger,
      )
    ) {
      ctx.ui.notify(
        `Context Ledger aktualisiert (${trigger}) → ${CONTEXT_LEDGER_RELATIVE_PATH}`,
        "info",
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.ui.notify(`Context Ledger konnte nicht aktualisiert werden: ${message}`, "warning");
  }
}
