/**
 * Locating the agent module and its offline test seam.
 *
 * Mirrors benchmarks/harness/p3/agent.mjs: P4_AGENT_MODULE/P4_OFFLINE_TEST
 * are the only way to point a P4 run at a stub instead of the real,
 * globally installed Pi binary, and that override only works when the test
 * seam itself is explicitly enabled.
 */
import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { GLOBAL_PI_BIN, SOURCE_ROOT } from "./config.mjs";

function fail(message) {
  throw new Error(message);
}

function defaultAgentModule() {
  const configured = process.env.P4_PI_BIN ?? GLOBAL_PI_BIN;
  if (!isAbsolute(configured) || !existsSync(configured)) {
    fail("P4_PI_BIN must name an existing absolute Pi executable.");
  }
  return realpathSync(configured);
}

export function isOfflineTest() {
  return process.env.P4_OFFLINE_TEST === "1";
}

export function agentModule() {
  const override = process.env.P4_AGENT_MODULE;
  if (!override) return defaultAgentModule();
  if (!isOfflineTest()) {
    fail("P4_AGENT_MODULE is reserved for the offline controller test.");
  }
  const candidate = resolve(override);
  const sourcePrefix = `${SOURCE_ROOT}/`;
  if (!candidate.startsWith(sourcePrefix) || !existsSync(candidate)) {
    fail(
      "P4_AGENT_MODULE must name an existing module inside the source checkout.",
    );
  }
  return candidate;
}

export function agentInvocation() {
  if (process.env.P4_AGENT_MODULE) return [process.execPath, agentModule()];
  return [agentModule()];
}
