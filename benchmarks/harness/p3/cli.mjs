/**
 * Argument parsing, usage and exit codes.
 */
import {
  commandCleanup,
  commandFinish,
  commandLaunch,
  commandPrepare,
  commandSummarize,
  commandValidate,
} from "./commands.mjs";
import { fail } from "./io.mjs";

function usage() {
  return `Usage: node benchmarks/harness/p3.mjs <command> [run-id]

Commands:
  validate                 validate the immutable manifest and local prerequisites
  prepare <run-id>         create one isolated P3 worktree and explicit session path
  launch <run-id>          run the benchmark task (or an unscored diagnostic)
  finish <run-id>          collect metrics and write the result to local state
  cleanup <run-id> [--purge] remove credential links and the isolated worktree
  summarize                print completion status for the 33 scored runs
`;
}

export async function main(argv) {
  const [command, id, ...rest] = argv;
  if (!command || command === "--help" || command === "-h") {
    process.stdout.write(usage());
    return;
  }
  if (command === "validate" && !id) return commandValidate();
  if (command === "summarize" && !id) return commandSummarize();
  if (["prepare", "launch", "finish", "cleanup"].includes(command) && id) {
    if (command === "cleanup") {
      if (rest.length > 1 || (rest.length === 1 && rest[0] !== "--purge"))
        fail(usage());
      return commandCleanup(id, rest[0] === "--purge");
    }
    if (rest.length !== 0) fail(usage());
    if (command === "prepare") return commandPrepare(id);
    if (command === "launch") return commandLaunch(id);
    return commandFinish(id);
  }
  fail(usage());
}
