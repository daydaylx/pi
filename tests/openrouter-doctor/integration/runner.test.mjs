/**
 * Exercises http.ts's safety limits (retry, circuit breaker, concurrency,
 * abort) and the check functions end-to-end against a fake `fetch` — no
 * real network access, per the "no real API calls in unit tests" rule.
 */
import { assert, counters, eq, test } from "../../shared/assertions.mjs";
import { importModule as load } from "../../shared/jiti-loader.mjs";

const { orFetchJson, createRequestGate, CircuitBreaker, parseRetryAfter } = await load("extensions/openrouter-doctor/http.ts");
const { checkCatalog } = await load("extensions/openrouter-doctor/checks/catalog.ts");
const { checkAuth } = await load("extensions/openrouter-doctor/checks/auth.ts");
const { checkInference } = await load("extensions/openrouter-doctor/checks/inference.ts");

const originalFetch = globalThis.fetch;

function jsonResponse(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () => body,
    clone() {
      return jsonResponse(status, body, headers);
    },
  };
}

function deps(overrides = {}) {
  return { gate: createRequestGate(), breaker: new CircuitBreaker(), signal: new AbortController().signal, ...overrides };
}

async function withFakeFetch(impl, run) {
  globalThis.fetch = impl;
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

await test("orFetchJson succeeds on the first try and needs no retry", async () => {
  let calls = 0;
  await withFakeFetch(
    async () => {
      calls += 1;
      return jsonResponse(200, { ok: true });
    },
    async () => {
      const result = await orFetchJson("https://example.invalid/x", {}, deps());
      assert(result.ok, "request succeeds");
      eq(calls, 1, "exactly one fetch call");
    },
  );
});

await test("orFetchJson retries a retryable 503 and eventually succeeds", async () => {
  let calls = 0;
  await withFakeFetch(
    async () => {
      calls += 1;
      if (calls < 2) return jsonResponse(503, { error: { message: "unavailable" } });
      return jsonResponse(200, { ok: true });
    },
    async () => {
      const result = await orFetchJson("https://example.invalid/x", {}, deps());
      assert(result.ok, "eventually succeeds");
      eq(calls, 2, "retried exactly once");
    },
  );
});

await test("orFetchJson does not retry a non-retryable 404", async () => {
  let calls = 0;
  await withFakeFetch(
    async () => {
      calls += 1;
      return jsonResponse(404, { error: { code: "model_not_found", message: "not found" } });
    },
    async () => {
      const result = await orFetchJson("https://example.invalid/x", {}, deps());
      assert(!result.ok, "request fails");
      eq(calls, 1, "no retry attempted for a non-retryable status");
    },
  );
});

await test("orFetchJson honors Retry-After and stops at the retry ceiling", async () => {
  let calls = 0;
  await withFakeFetch(
    async () => {
      calls += 1;
      return jsonResponse(429, { error: { message: "rate limited" } }, { "retry-after": "0" });
    },
    async () => {
      const result = await orFetchJson("https://example.invalid/x", {}, deps());
      assert(!result.ok, "still fails after exhausting retries");
      eq(calls, 4, "exactly MAX_RETRIES + 1 attempts");
    },
  );
});

await test("orFetchJson caps a server-provided Retry-After at ten seconds", () => {
  eq(parseRetryAfter(new Headers({ "retry-after": "3600" })), 10, "wait is bounded at ten seconds");
});

await test("orFetchJson aborts during a Retry-After wait without another request", async () => {
  let calls = 0;
  const controller = new AbortController();
  await withFakeFetch(
    async () => {
      calls += 1;
      return jsonResponse(429, { error: { message: "rate limited" } }, { "retry-after": "10" });
    },
    async () => {
      setTimeout(() => controller.abort(), 0);
      const result = await orFetchJson("https://example.invalid/x", {}, deps({ signal: controller.signal }));
      assert(!result.ok, "aborted retry fails");
      eq(result.error.kind, "abort", "reported as abort");
      eq(calls, 1, "no retry follows an abort");
    },
  );
});

await test("checkInference does not retry a billable request", async () => {
  let calls = 0;
  await withFakeFetch(
    async () => {
      calls += 1;
      return jsonResponse(503, { error: { message: "unavailable" } });
    },
    async () => {
      const result = await checkInference("openai/gpt-oss-120b", {
        baseUrl: "https://example.invalid",
        headers: {},
        ...deps(),
      });
      eq(result.status, "fail", "reports the failed inference request");
      eq(calls, 1, "performs no billable retry");
    },
  );
});

await test("CircuitBreaker opens after 3 consecutive failures and resets on success", () => {
  const breaker = new CircuitBreaker();
  eq(breaker.isOpen(), false, "starts closed");
  breaker.recordFailure();
  breaker.recordFailure();
  eq(breaker.isOpen(), false, "still closed below the threshold");
  breaker.recordFailure();
  eq(breaker.isOpen(), true, "opens at the threshold");
  breaker.recordSuccess();
  eq(breaker.isOpen(), false, "a success resets it");
});

await test("orFetchJson short-circuits without a network call while the breaker is open", async () => {
  let calls = 0;
  const breaker = new CircuitBreaker();
  breaker.recordFailure();
  breaker.recordFailure();
  breaker.recordFailure();
  await withFakeFetch(
    async () => {
      calls += 1;
      return jsonResponse(200, { ok: true });
    },
    async () => {
      const result = await orFetchJson("https://example.invalid/x", {}, deps({ breaker }));
      assert(!result.ok, "request is rejected while open");
      eq(result.error.kind, "network", "reported as a network-shaped failure");
      eq(calls, 0, "no fetch call was made");
    },
  );
});

await test("orFetchJson returns an abort result immediately for an already-aborted signal", async () => {
  let calls = 0;
  const controller = new AbortController();
  controller.abort();
  await withFakeFetch(
    async () => {
      calls += 1;
      return jsonResponse(200, { ok: true });
    },
    async () => {
      const result = await orFetchJson("https://example.invalid/x", {}, deps({ signal: controller.signal }));
      assert(!result.ok, "aborted request fails");
      eq(result.error.kind, "abort", "reported as abort");
      eq(calls, 0, "no fetch call was made once already aborted");
    },
  );
});

await test("orFetchJson never exceeds the configured concurrency limit", async () => {
  let active = 0;
  let maxActive = 0;
  const gate = createRequestGate();
  await withFakeFetch(
    async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active -= 1;
      return jsonResponse(200, { ok: true });
    },
    async () => {
      await Promise.all(
        Array.from({ length: 6 }, () => orFetchJson("https://example.invalid/x", {}, deps({ gate }))),
      );
      assert(maxActive <= 3, `never more than 3 concurrent requests (saw ${maxActive})`);
    },
  );
});

await test("checkCatalog, checkAuth and checkInference resolve to CheckResults against fixture-shaped responses", async () => {
  await withFakeFetch(
    async (url) => {
      const target = String(url);
      if (target.endsWith("/models")) {
        return jsonResponse(200, {
          data: [{ id: "openai/gpt-oss-120b", supported_parameters: ["tools", "reasoning"] }],
        });
      }
      if (target.endsWith("/key")) return jsonResponse(200, { data: { label: "test" } });
      if (target.endsWith("/chat/completions")) {
        return jsonResponse(200, { choices: [{ message: { content: "OK" } }] });
      }
      return jsonResponse(404, { error: { message: "unexpected path in test" } });
    },
    async () => {
      const requestDeps = { baseUrl: "https://example.invalid", headers: {}, ...deps() };
      const catalog = await checkCatalog("openai/gpt-oss-120b", requestDeps);
      eq(catalog.status, "ok", "catalog check finds the model");
      const auth = await checkAuth(requestDeps);
      eq(auth.status, "ok", "auth check succeeds");
      const inference = await checkInference("openai/gpt-oss-120b", requestDeps);
      eq(inference.status, "ok", "inference check succeeds");
      eq(inference.data.content, "OK", "inference content extracted");
    },
  );
});

await test("a failing catalog fetch never throws and does not block other checks from running", async () => {
  await withFakeFetch(
    async () => {
      throw new TypeError("simulated network failure");
    },
    async () => {
      const requestDeps = { baseUrl: "https://example.invalid", headers: {}, ...deps() };
      const catalog = await checkCatalog("openai/gpt-oss-120b", requestDeps);
      eq(catalog.status, "unknown", "network failure reported as unknown, not a throw");
      // A second, independent check still runs normally afterwards.
      const auth = await checkAuth(requestDeps);
      eq(auth.status, "fail", "auth check still ran independently and reported its own failure");
    },
  );
});

const { passed, failed } = counters();
if (failed > 0) {
  console.error(`\nFAIL: ${passed} passed, ${failed} failed`);
  process.exit(1);
}
console.log(`PASS: ${passed} passed, 0 failed`);
