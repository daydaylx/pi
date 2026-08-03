import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const schema = JSON.parse(
  readFileSync(
    new URL("../schema/p4-run-result.schema.json", import.meta.url),
    "utf8",
  ),
);
const seriesIdPattern = new RegExp(schema.properties.seriesId.pattern);

assert(
  seriesIdPattern.test("P4"),
  "the same-model series id is still accepted",
);
assert(
  seriesIdPattern.test("P4-production"),
  "the production-stack series id is accepted (P1-10; stack-manifest.mjs already allowed it, the schema previously did not)",
);
assert(!seriesIdPattern.test("P5"), "an unrelated series id is still rejected");
assert(
  !seriesIdPattern.test("P4-other"),
  "an unknown P4 suffix is still rejected",
);

console.log("P4 run-result schema test passed.");
