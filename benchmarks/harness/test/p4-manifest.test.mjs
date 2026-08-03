import assert from "node:assert/strict";
import { loadP4Manifest, validateP4Manifest } from "../p4-manifest.mjs";

const manifest = loadP4Manifest();
assert.equal(validateP4Manifest(manifest), true);
assert.throws(
  () =>
    validateP4Manifest({
      ...manifest,
      roles: {
        ...manifest.roles,
        debugger: { model: "other", thinking: "high" },
      },
    }),
  /one model/,
);
assert.throws(
  () => validateP4Manifest({ ...manifest, privateEvaluator: "optional" }),
  /private evaluator/,
);
console.log("P4 manifest test passed.");
