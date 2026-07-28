#!/usr/bin/env node
/**
 * P3 benchmark controller.
 *
 * This controller deliberately keeps all mutable material outside the source
 * checkout. It never reads, copies, prints, or serializes credentials: the
 * two runtime credential files are only linked into an isolated worktree for
 * the lifetime of one run.
 *
 * This file stays the entry point — RUNBOOK.md, the harness test and the
 * results tooling all address `benchmarks/harness/p3.mjs`. The controller
 * itself lives in p3/:
 *
 *   config.mjs        fixed benchmark parameters
 *   io.mjs            private state directory, JSON, git
 *   manifest.mjs      the immutable run plan and its validation
 *   agent.mjs         locating the agent module and its invocation
 *   worktree.mjs      isolated worktree, credential links, overlays
 *   prompts.mjs       task input, prompt and prompt fingerprint
 *   process.mjs       spawning the agent and measuring it
 *   metrics.mjs       reading raw run artefacts
 *   verification.mjs  the post-run verification step
 *   commands.mjs      validate / prepare / launch / finish / cleanup / summarize
 *   cli.mjs           arguments, usage, exit codes
 */
import { main } from "./p3/cli.mjs";

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(
    `P3: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
