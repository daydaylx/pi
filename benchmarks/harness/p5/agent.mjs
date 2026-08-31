/**
 * Locating the Pi agent module/binary and its offline test seam.
 * Mirrors benchmarks/harness/p4/agent.mjs. P5_PI_BIN/P5_AGENT_MODULE +
 * P5_OFFLINE_TEST are the only way to point a P5 Pi run at a stub instead of
 * the real, globally installed Pi binary.
 */
import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { GLOBAL_PI_BIN, SOURCE_ROOT } from "./config.mjs";

function fail(message) {
  throw new Error(message);
}

function defaultAgentModule() {
  const configured = process.env.P5_PI_BIN ?? GLOBAL_PI_BIN;
  if (!isAbsolute(configured) || !existsSync(configured)) {
    fail("P5_PI_BIN must name an existing absolute Pi executable.");
  }
  return realpathSync(configured);
}

export function isOfflineTest() {
  return process.env.P5_OFFLINE_TEST === "1";
}

export function agentModule() {
  const override = process.env.P5_AGENT_MODULE;
  if (!override) return defaultAgentModule();
  if (!isOfflineTest()) {
    fail("P5_AGENT_MODULE is reserved for the offline controller test.");
  }
  const candidate = resolve(override);
  const sourcePrefix = `${SOURCE_ROOT}/`;
  if (!candidate.startsWith(sourcePrefix) || !existsSync(candidate)) {
    fail(
      "P5_AGENT_MODULE must name an existing module inside the source checkout.",
    );
  }
  return candidate;
}

export function agentInvocation() {
  if (process.env.P5_AGENT_MODULE) return [process.execPath, agentModule()];
  return [agentModule()];
}
