/**
 * Resolving the Pi runtime's available models via `pi --list-models`.
 * Mirrors benchmarks/harness/p4/models.mjs, using P5's own agent.mjs seam.
 */
import { execFileSync } from "node:child_process";
import { agentInvocation, isOfflineTest } from "./agent.mjs";

function fail(message) {
  throw new Error(message);
}

export function listAvailableModels() {
  if (isOfflineTest()) {
    fail("listAvailableModels must not run under the offline test seam.");
  }
  const [command, ...args] = agentInvocation();
  const output = execFileSync(command, [...args, "--list-models"], {
    encoding: "utf8",
  });
  const models = [];
  for (const line of output.split("\n")) {
    const columns = line.trim().split(/\s{2,}/);
    if (columns.length < 2) continue;
    const [provider, model] = columns;
    if (provider === "provider" || !provider || !model) continue;
    models.push(`${provider}/${model}`);
  }
  if (models.length === 0) fail("pi --list-models returned no parsable rows.");
  return models;
}
