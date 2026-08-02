import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateStackManifest } from "../stack-manifest.mjs";

const root = new URL("../../..", import.meta.url).pathname;
const production = JSON.parse(readFileSync(new URL("../p4-production-stack-manifest.json", import.meta.url), "utf8"));
assert.equal(validateStackManifest(production, { root }), true);
assert.throws(() => validateStackManifest({ ...production, roles: { ...production.roles, worker: {} } }, { root }), /worker/);
console.log("P4 production stack manifest test passed.");
