/** Benchmark-only fail-open checkpoint of plan artifacts into the context ledger. */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  consolidateLedger,
  CONTEXT_LEDGER_RELATIVE_PATH,
  type LedgerTrigger,
} from "../shared/context-ledger.ts";
import {
  extractTodoItems,
  readDecisionBrief,
  readPlanFile,
} from "./utils.ts";

export const BENCHMARK_DISABLE_LEDGER_CHECKPOINTS_ENV =
  "PI_BENCHMARK_DISABLE_LEDGER_CHECKPOINTS";

export function ledgerCheckpointsEnabled(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return environment[BENCHMARK_DISABLE_LEDGER_CHECKPOINTS_ENV] !== "1";
}

function projectName(cwd: string): string {
  const parts = cwd.split(/[\\/]+/).filter(Boolean);
  return parts.at(-1) || "Projekt";
}

export function runLedgerCheckpoint(
  ctx: ExtensionContext,
  trigger: LedgerTrigger,
): void {
  try {
    if (!ledgerCheckpointsEnabled() || !ctx.isProjectTrusted()) return;
    let briefContent: string | undefined;
    let planContent: string | undefined;
    let openPriorities: string[] = [];
    try {
      briefContent = readDecisionBrief(ctx.cwd);
    } catch {}
    try {
      planContent = readPlanFile(ctx.cwd);
    } catch {}
    try {
      openPriorities = planContent
        ? extractTodoItems(planContent)
            .filter((todo) => !todo.completed)
            .map((todo) => todo.text)
        : [];
    } catch {}
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
    ctx.ui.notify(
      `Context Ledger konnte nicht aktualisiert werden: ${error instanceof Error ? error.message : String(error)}`,
      "warning",
    );
  }
}
