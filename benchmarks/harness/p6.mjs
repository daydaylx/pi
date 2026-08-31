#!/usr/bin/env node
/**
 * P6-TERRA-SUBAGENTS benchmark controller CLI entry point.
 * See benchmarks/comparisons/p6-terra-subagents/ for methodology/results.
 * Reuses P5's harness-generic launch/metrics modules unchanged; only
 * p6-manifest.mjs/p6-controller.mjs/p6/io.mjs/p6/cli.mjs are new.
 */
import { main } from "./p6/cli.mjs";

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(
    `P6: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
