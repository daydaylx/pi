/**
 * The post-run verification step for a scored task.
 */
import { chmodSync, closeSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  FIXTURE_TEST_TASKS,
  HERE,
  NO_VERIFY_TASKS,
  SOURCE_ROOT,
} from "./config.mjs";
import { fail, readJson, writePrivateJson } from "./io.mjs";
import { spawnToFiles } from "./process.mjs";

export async function runVerification(run, paths) {
  if (NO_VERIFY_TASKS.has(run.task)) return null;
  const output = join(paths.runDir, "verify-result.json");
  if (!FIXTURE_TEST_TASKS.has(run.task)) {
    const { openSync } = await import("node:fs");
    const fd = openSync(output, "w", 0o600);
    try {
      await spawnToFiles(join(HERE, "run-verify.sh"), [paths.worktree], {
        cwd: SOURCE_ROOT,
        env: { ...process.env, PI_CODING_AGENT_DIR: paths.worktree },
        stdio: ["ignore", fd, "ignore"],
      });
    } finally {
      closeSync(fd);
    }
    const verify = readJson(output, "P3 verification result");
    if (
      !Number.isInteger(verify.exitCode) ||
      !Number.isInteger(verify.durationMs)
    ) {
      fail("P3 verification result has an invalid contract.");
    }
    chmodSync(output, 0o600);
    return output;
  }

  const logFile = join(paths.runDir, "verify.log");
  writeFileSync(logFile, "", { mode: 0o600 });
  const { openSync } = await import("node:fs");
  const fd = openSync(logFile, "a", 0o600);
  const started = Date.now();
  let result;
  try {
    result = await spawnToFiles(
      process.execPath,
      [join(paths.worktree, "benchmark-fixture", "run-fixture-test.mjs")],
      {
        cwd: paths.worktree,
        env: { ...process.env, PI_CODING_AGENT_DIR: paths.worktree },
        stdio: ["ignore", fd, fd],
      },
    );
  } finally {
    closeSync(fd);
  }
  const verify = {
    exitCode: result.code,
    durationMs: Date.now() - started,
    logFile,
  };
  writePrivateJson(output, verify);
  return output;
}
