#!/usr/bin/env node
/**
 * P5-LUNA-HARNESS benchmark controller CLI entry point.
 *
 * See docs/comparisons/p5-luna/METHODOLOGY.md for the series' fairness rules.
 * Implementation lives in p5/:
 *
 *   config.mjs                fixed paths and the Pi/Codex binary locations
 *   agent.mjs                  locating the Pi agent module and its offline test seam
 *   io.mjs                     private CLI state directory and per-run paths (both harnesses)
 *   models.mjs                 available Pi model discovery via `pi --list-models`
 *   worktree-setup.mjs         npm/node_modules link + Pi settings.json overlay
 *   launch-pi.mjs              the real launchAgent for harness "pi"
 *   launch-codex.mjs           the real launchAgent for harness "codex"
 *   collect-pi-metrics.mjs     Pi-side automaticMetrics via collect-metrics.mjs
 *   collect-codex-metrics.mjs  Codex-side automaticMetrics from the rollout JSONL
 *   cli.mjs                    validate / run / summarize commands
 */
import { main } from "./p5/cli.mjs";

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(
    `P5: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
