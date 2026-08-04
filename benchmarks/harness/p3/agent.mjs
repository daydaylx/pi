/**
 * Locating the agent module and building its invocation.
 *
 * The offline test path is explicit (P3_AGENT_MODULE / P3_OFFLINE_TEST) so a
 * test run can never accidentally reach the real runtime.
 */
import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { GLOBAL_PI_BIN, SOURCE_ROOT } from "./config.mjs";
import { fail, privateDir } from "./io.mjs";

function defaultAgentModule() {
  const configured = process.env.P3_PI_BIN ?? GLOBAL_PI_BIN;
  if (!isAbsolute(configured) || !existsSync(configured)) {
    fail("P3_PI_BIN must name an existing absolute Pi executable.");
  }
  return realpathSync(configured);
}

export function isOfflineTest() {
  return process.env.P3_OFFLINE_TEST === "1";
}

export function agentModule() {
  // Kept solely as an offline test seam. Production runs always use the local
  // pinned Pi runtime; an override must remain inside this source checkout.
  const override = process.env.P3_AGENT_MODULE;
  if (!override) return defaultAgentModule();
  if (!isOfflineTest()) {
    fail("P3_AGENT_MODULE is reserved for the offline controller test.");
  }
  const candidate = resolve(override);
  const sourcePrefix = `${SOURCE_ROOT}/`;
  if (!candidate.startsWith(sourcePrefix) || !existsSync(candidate)) {
    fail(
      "P3_AGENT_MODULE must name an existing module inside the source checkout.",
    );
  }
  return candidate;
}

export function runtimePackagePath(entrypoint) {
  if (process.env.P3_AGENT_MODULE) {
    return join(
      SOURCE_ROOT,
      "npm/node_modules/@earendil-works/pi-coding-agent/package.json",
    );
  }
  return join(dirname(dirname(entrypoint)), "package.json");
}

export function agentInvocation(run, paths) {
  const v8Args = diagnosticV8Args(run, paths);
  const entrypoint = agentModule();
  if (process.env.P3_AGENT_MODULE || v8Args.length > 0) {
    return [process.execPath, ...v8Args, entrypoint];
  }
  return [entrypoint];
}

export function diagnosticV8Args(run, paths) {
  if (run.scored) return [];
  privateDir(join(paths.runDir, "diagnostics"));
  if (run.mode === "v8-cpu-prof")
    return ["--cpu-prof", "--cpu-prof-dir", join(paths.runDir, "diagnostics")];
  if (run.mode === "v8-heap-prof")
    return [
      "--heap-prof",
      "--heap-prof-dir",
      join(paths.runDir, "diagnostics"),
    ];
  fail(`Unknown diagnostic V8 mode '${run.mode}'.`);
}
