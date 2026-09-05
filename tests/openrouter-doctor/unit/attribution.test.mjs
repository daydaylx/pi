/**
 * Coverage for the attribution check: detects OpenRouter's "Gate Free
 * Endpoints by Agentic Harness" signature and distinguishes it from ordinary
 * permission failures, without ever needing a live request of its own.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { assert, counters, eq, test } from "../../shared/assertions.mjs";
import { importModule as load, ROOT } from "../../shared/jiti-loader.mjs";

const FIXTURES = path.join(
  ROOT,
  "tests",
  "fixtures",
  "openrouter-doctor",
  "error-scenarios",
);

const { checkAttribution } = await load(
  "extensions/openrouter-doctor/checks/attribution.ts",
);
const { normalizeError } = await load(
  "extensions/openrouter-doctor/diagnostics/normalize-error.ts",
);

function readFixture(name) {
  return JSON.parse(readFileSync(path.join(FIXTURES, `${name}.json`), "utf8"));
}

function inferenceFromFixture(name) {
  const fixture = readFixture(name);
  return {
    id: "inference",
    label: "Inference",
    status: "fail",
    summary: "Minimaler Inference-Request fehlgeschlagen.",
    error: normalizeError({
      kind: "http",
      status: fixture.status,
      code: fixture.error?.code,
      message: fixture.error?.message,
    }),
  };
}

const OK_INFERENCE = {
  id: "inference",
  label: "Inference",
  status: "ok",
  summary: "Modell antwortet auf Anfragen.",
};

await test("checkAttribution reports ok when inference already succeeded", () => {
  const result = checkAttribution(OK_INFERENCE, {});
  eq(result.status, "ok", "not applicable when inference works");
  eq(result.id, "attribution", "carries the attribution id");
});

await test("checkAttribution reports ok for an unrelated 403 (not the harness gate)", () => {
  const inference = inferenceFromFixture("403-permission");
  const result = checkAttribution(inference, {});
  eq(result.status, "ok", "a generic 403 is not the agentic-harness signature");
});

await test("checkAttribution reports ok for an unrelated failure category (e.g. 401)", () => {
  const inference = inferenceFromFixture("401-auth-failed");
  const result = checkAttribution(inference, {});
  eq(
    result.status,
    "ok",
    "authentication failures are out of scope for this check",
  );
});

await test("checkAttribution reports fail when the harness gate fires and no attribution header is present", () => {
  const inference = inferenceFromFixture("403-agentic-harness-gate");
  const result = checkAttribution(inference, {
    "content-type": "application/json",
  });
  eq(result.status, "fail", "flags the missing attribution");
  eq(
    result.error.category,
    "attribution",
    "uses the dedicated attribution category",
  );
  assert(
    /Agentic-Harness-Attribution/.test(result.summary),
    "summary names the actual problem",
  );
  assert(
    /models\.json/.test(result.error.recommendedAction),
    "recommendation points at models.json",
  );
  assert(
    /providers\.openrouter\.headers/.test(result.error.recommendedAction),
    "recommendation names the config path",
  );
});

await test("checkAttribution recognizes attribution headers case-insensitively", () => {
  const inference = inferenceFromFixture("403-agentic-harness-gate");
  const result = checkAttribution(inference, {
    "X-OpenRouter-Categories": "cli-agent",
  });
  eq(
    result.status,
    "warn",
    "attribution already present, so this is a different, unexplained gate failure",
  );
});

await test("checkAttribution also recognizes HTTP-Referer + X-OpenRouter-Title as attribution", () => {
  const inference = inferenceFromFixture("403-agentic-harness-gate");
  const result = checkAttribution(inference, {
    "http-referer": "https://pi.dev",
    "x-openrouter-title": "pi",
  });
  eq(result.status, "warn", "referer+title pair counts as attribution too");
});

const { passed, failed } = counters();
if (failed > 0) {
  console.error(`\nFAIL: ${passed} passed, ${failed} failed`);
  process.exit(1);
}
console.log(`PASS: ${passed} passed, 0 failed`);
