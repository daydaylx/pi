/**
 * Table-driven coverage of every error category the doctor must recognize.
 * Fixtures live under tests/fixtures/openrouter-doctor/error-scenarios/ and
 * mirror what OpenRouter actually returns (status + `error.{code,message}`).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, counters, eq, test } from "../../shared/assertions.mjs";
import { importModule as load, ROOT } from "../../shared/jiti-loader.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(ROOT, "tests", "fixtures", "openrouter-doctor", "error-scenarios");

const { normalizeError } = await load("extensions/openrouter-doctor/diagnostics/normalize-error.ts");

function readFixture(name) {
  return JSON.parse(readFileSync(path.join(FIXTURES, `${name}.json`), "utf8"));
}

function toRawHttpError(fixture) {
  return {
    kind: "http",
    status: fixture.status,
    code: fixture.error?.code,
    message: fixture.error?.message,
    retryAfterSeconds: fixture.retryAfterSeconds,
  };
}

const HTTP_CASES = [
  ["400-invalid-request", "invalid-request"],
  ["401-auth-failed", "authentication"],
  ["403-permission", "permission"],
  ["404-model-not-found", "model-not-found"],
  ["404-no-endpoints", "no-endpoints"],
  ["429-rate-limit", "rate-limit"],
  ["429-credit-limit", "rate-limit"],
  ["502-bad-gateway", "gateway"],
  ["503-unavailable", "gateway"],
  ["524-timeout", "gateway"],
  ["529-provider-overload", "gateway"],
];

for (const [fixtureName, expectedCategory] of HTTP_CASES) {
  await test(`normalizeError classifies ${fixtureName} as ${expectedCategory}`, () => {
    const fixture = readFixture(fixtureName);
    const normalized = normalizeError(toRawHttpError(fixture));
    eq(normalized.category, expectedCategory, "category matches");
    eq(normalized.httpStatus, fixture.status, "httpStatus preserved");
    assert(normalized.humanSummary.length > 0, "has a human summary");
    assert(normalized.likelyCauses.length > 0, "has at least one likely cause");
    assert(normalized.recommendedAction.length > 0, "has a recommended action");
  });
}

await test("normalizeError preserves Retry-After on 429", () => {
  const normalized = normalizeError(toRawHttpError(readFixture("429-rate-limit")));
  eq(normalized.retryAfterSeconds, 20, "retryAfterSeconds passed through");
});

await test("normalizeError distinguishes credit/budget wording in rate-limit causes", () => {
  const normalized = normalizeError(toRawHttpError(readFixture("429-credit-limit")));
  assert(
    normalized.likelyCauses.some((cause) => /guthaben|budget/i.test(cause)),
    "mentions a budget/credit cause first",
  );
});

await test("normalizeError handles timeout", () => {
  const normalized = normalizeError({ kind: "timeout" });
  eq(normalized.category, "timeout", "timeout category");
});

await test("normalizeError handles abort as timeout-shaped, not a reportable failure category", () => {
  const normalized = normalizeError({ kind: "abort" });
  eq(normalized.category, "timeout", "abort maps to timeout category");
});

await test("normalizeError handles network failures", () => {
  const normalized = normalizeError({ kind: "network", message: "fetch failed" });
  eq(normalized.category, "network", "network category");
});

await test("normalizeError gives a distinct message for an open circuit breaker", () => {
  const normalized = normalizeError({ kind: "network", message: "circuit-open" });
  eq(normalized.category, "network", "still network category");
  assert(/nicht verfügbar/i.test(normalized.humanSummary), "explains OpenRouter looks unavailable");
});

await test("normalizeError handles invalid JSON responses", () => {
  const normalized = normalizeError({ kind: "invalid-json" });
  eq(normalized.category, "unknown", "invalid JSON maps to unknown category");
  assert(/JSON/.test(normalized.humanSummary), "mentions JSON in the summary");
});

await test("normalizeError never leaks Authorization/API-key material into rawDetails", () => {
  const normalized = normalizeError(
    toRawHttpError({ status: 401, error: { code: "invalid_api_key", message: "No auth credentials found" } }),
  );
  const serialized = JSON.stringify(normalized);
  assert(!/authorization/i.test(serialized), "no Authorization header text");
  assert(!/bearer\s+sk-/i.test(serialized), "no bearer key material");
});

await test("normalizeError falls back to a generic unknown category for an unmapped status", () => {
  const normalized = normalizeError({ kind: "http", status: 418, message: "I'm a teapot" });
  eq(normalized.category, "unknown", "unmapped status falls back to unknown");
});

const { passed, failed } = counters();
if (failed > 0) {
  console.error(`\nFAIL: ${passed} passed, ${failed} failed`);
  process.exit(1);
}
console.log(`PASS: ${passed} passed, 0 failed`);
