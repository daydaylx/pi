import assert from "node:assert/strict";
import { loadP5Manifest, validateP5Manifest } from "../p5-manifest.mjs";

const root = new URL("../../..", import.meta.url).pathname;
const manifest = loadP5Manifest();

assert.equal(validateP5Manifest(manifest, { root }), true);
assert.equal(manifest.seriesId, "P5-LUNA-HARNESS");
assert.equal(manifest.harnesses.pi.model, "gpt-5.6-luna");
assert.equal(manifest.harnesses.codex.model, "gpt-5.6-luna");
assert.equal(
  manifest.harnesses.pi.thinking,
  manifest.harnesses.codex.reasoningEffort,
);
assert.equal(manifest.harnesses.pi.roles.verifier.enabled, false);
assert.equal(manifest.harnesses.codex.sandbox, "workspace-write");
assert.equal(manifest.harnesses.codex.networkAccess, false);

const runIds = manifest.runs.map((run) => run.id);
assert.equal(new Set(runIds).size, runIds.length, "run ids must be unique");
assert(
  runIds.includes("p5-smoke-05-pi") && runIds.includes("p5-smoke-05-codex"),
  "manifest must include the smoketest pair",
);

// A manifest with a mismatched reasoning effort between harnesses must be rejected.
const mismatched = JSON.parse(JSON.stringify(manifest));
mismatched.harnesses.codex.reasoningEffort = "xhigh";
assert.throws(
  () => validateP5Manifest(mismatched, { root }),
  /same reasoning effort/,
);

// A manifest with the Pi verifier enabled must be rejected (Core Parity requires it off).
const verifierEnabled = JSON.parse(JSON.stringify(manifest));
verifierEnabled.harnesses.pi.roles.verifier = {
  model: "openai-codex/gpt-5.6-luna",
  thinking: "high",
};
assert.throws(
  () => validateP5Manifest(verifierEnabled, { root }),
  /verifier role to be disabled/,
);

console.log("p5 manifest test passed");
