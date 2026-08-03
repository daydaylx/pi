#!/usr/bin/env node
/**
 * P4 benchmark controller CLI entry point.
 *
 * RUNBOOK.md and any tooling should address `benchmarks/harness/p4.mjs`; the
 * implementation lives in p4/:
 *
 *   config.mjs              fixed paths and the launch pi binary location
 *   agent.mjs                locating the agent module and its offline test seam
 *   io.mjs                   private CLI state directory and per-run paths
 *   models.mjs                available-model discovery via `pi --list-models`
 *   subagent-artifacts.mjs   reading real per-role model/timing metadata
 *   launch.mjs                the real launchAgent p4-controller.mjs's runP4Task calls
 *   cli.mjs                   validate / run / summarize commands
 */
import { main } from "./p4/cli.mjs";

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(
    `P4: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
