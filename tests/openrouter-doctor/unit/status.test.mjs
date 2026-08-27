import { assert, counters, eq, test } from "../../shared/assertions.mjs";
import { importModule as load } from "../../shared/jiti-loader.mjs";

const { aggregateStatus } = await load("extensions/openrouter-doctor/diagnostics/status.ts");

function check(id, status, overrides = {}) {
  return { id, label: id, status, summary: "", ...overrides };
}

await test("aggregateStatus is HEALTHY only when every check is ok", () => {
  eq(
    aggregateStatus([check("catalog", "ok"), check("auth", "ok"), check("inference", "ok")]),
    "HEALTHY",
    "all-ok checks are HEALTHY",
  );
});

await test("aggregateStatus is BROKEN when the catalog check fails", () => {
  eq(aggregateStatus([check("catalog", "fail"), check("auth", "ok")]), "BROKEN", "catalog fail is BROKEN");
});

await test("aggregateStatus is BROKEN when auth fails", () => {
  eq(aggregateStatus([check("catalog", "ok"), check("auth", "fail")]), "BROKEN", "auth fail is BROKEN");
});

await test("aggregateStatus is BROKEN when basic inference fails", () => {
  eq(
    aggregateStatus([check("catalog", "ok"), check("auth", "ok"), check("inference", "fail")]),
    "BROKEN",
    "inference fail is BROKEN",
  );
});

await test("aggregateStatus is DEGRADED, not BROKEN, when a no-endpoints error hits only a deep check", () => {
  // Canonical case from the spec: strict Pi routing has no compatible
  // endpoint, but the model itself (basic inference) still works.
  const noEndpoints = check("strict-parameters", "fail", { error: { category: "no-endpoints" } });
  const result = aggregateStatus([check("catalog", "ok"), check("auth", "ok"), check("inference", "ok"), noEndpoints]);
  eq(result, "DEGRADED", "deep-check no-endpoints failure is DEGRADED — the model itself still works");
});

await test("aggregateStatus is BROKEN when basic inference itself fails with a no-endpoints error", () => {
  const noEndpoints = check("inference", "fail", { error: { category: "no-endpoints" } });
  eq(aggregateStatus([check("catalog", "ok"), check("auth", "ok"), noEndpoints]), "BROKEN", "no usable endpoint at all is BROKEN");
});

await test("aggregateStatus is DEGRADED when a deep check fails but the basics work", () => {
  const result = aggregateStatus([
    check("catalog", "ok"),
    check("auth", "ok"),
    check("inference", "ok"),
    check("tools", "fail"),
  ]);
  eq(result, "DEGRADED", "non-basic failure is DEGRADED, not BROKEN");
});

await test("aggregateStatus is DEGRADED on an unknown check, never a silent HEALTHY", () => {
  const result = aggregateStatus([check("catalog", "ok"), check("auth", "ok"), check("inference", "unknown")]);
  eq(result, "DEGRADED", "unresolved check keeps status from claiming HEALTHY");
});

await test("aggregateStatus never returns anything outside the three documented statuses", () => {
  const statuses = new Set();
  for (const status of ["ok", "warn", "fail", "unknown"]) {
    statuses.add(aggregateStatus([check("catalog", status)]));
  }
  for (const value of statuses) {
    assert(["HEALTHY", "DEGRADED", "BROKEN"].includes(value), `${value} is one of the three statuses`);
  }
});

await test("aggregateStatus treats an empty check list as BROKEN, not a silent HEALTHY", () => {
  eq(aggregateStatus([]), "BROKEN", "no evidence at all cannot be HEALTHY");
});

const { passed, failed } = counters();
if (failed > 0) {
  console.error(`\nFAIL: ${passed} passed, ${failed} failed`);
  process.exit(1);
}
console.log(`PASS: ${passed} passed, 0 failed`);
