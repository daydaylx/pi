/**
 * Loads the real extension entry point through the shared mock ExtensionAPI
 * (tests/shared/harness.mjs) and drives /openrouter-doctor end to end
 * against a fake `fetch` — this is also what activates
 * extensions/openrouter-doctor/index.ts for the repo's V8 function-coverage
 * gate (tests/coverage.mjs requires the entry file to actually run).
 */
import { assert, counters, eq, test } from "../../shared/assertions.mjs";
import { createHarness } from "../../shared/harness.mjs";
import { importModule as load } from "../../shared/jiti-loader.mjs";

const extension = await load("extensions/openrouter-doctor/index.ts");

const originalFetch = globalThis.fetch;

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
    clone() {
      return jsonResponse(status, body);
    },
  };
}

const MODEL = {
  id: "openai/gpt-oss-120b",
  name: "GPT-OSS 120B",
  api: "openai-completions",
  provider: "openrouter",
  baseUrl: "https://example.invalid",
  reasoning: true,
  input: ["text"],
  cost: { input: 0, output: 0 },
  contextWindow: 131072,
  maxTokens: 4096,
};

function harnessWithModel(options = {}) {
  return createHarness({
    models: { "openrouter/openai/gpt-oss-120b": MODEL },
    getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "test-key", baseUrl: "https://example.invalid", headers: {} }),
    ...options,
  });
}

async function runCommand(harness, args) {
  extension.default(harness.api);
  const context = harness.makeContext();
  await harness.commands.get("openrouter-doctor")(args, context);
  return harness;
}

async function withFakeFetch(impl, run) {
  globalThis.fetch = impl;
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function deepFetch(url, init) {
  const target = String(url);
  const body = init?.body ? JSON.parse(init.body) : undefined;
  if (target.endsWith("/models")) {
    return jsonResponse(200, {
      data: [{ id: "openai/gpt-oss-120b", supported_parameters: ["tools", "tool_choice", "reasoning"] }],
    });
  }
  if (target.endsWith("/key")) return jsonResponse(200, { data: { label: "test" } });
  if (target.endsWith("/endpoints")) {
    return jsonResponse(200, {
      data: { endpoints: [{ provider_name: "together" }, { provider_name: "deepinfra" }] },
    });
  }
  if (target.endsWith("/chat/completions")) {
    if (body?.tools) {
      return jsonResponse(200, {
        choices: [{ message: { tool_calls: [{ function: { name: "test_tool", arguments: '{"value":"OK"}' } }] } }],
      });
    }
    if (body?.provider?.require_parameters) {
      return jsonResponse(404, { error: { code: "no_endpoints", message: "No endpoints found for required parameters" } });
    }
    if (body?.provider?.only) {
      return body.provider.only[0] === "together"
        ? jsonResponse(200, { choices: [{ message: { content: "OK" } }] })
        : jsonResponse(529, { error: { message: "overloaded" } });
    }
    if (body?.reasoning) {
      return jsonResponse(200, { choices: [{ message: { content: "OK", reasoning: "short" } }] });
    }
    return jsonResponse(200, { choices: [{ message: { content: "OK" } }] });
  }
  return jsonResponse(404, { error: { message: `unexpected path in test: ${target}` } });
}

await test("registers the /openrouter-doctor command with a description", () => {
  const harness = createHarness();
  extension.default(harness.api);
  assert(harness.commands.has("openrouter-doctor"), "command is registered");
  assert(harness.commandDescriptions.get("openrouter-doctor").length > 0, "has a non-empty description");
});

await test("rejects an unknown flag with a usage message and makes no network calls", async () => {
  let calls = 0;
  await withFakeFetch(
    async () => {
      calls += 1;
      return jsonResponse(200, {});
    },
    async () => {
      const harness = await runCommand(harnessWithModel(), "--nonsense");
      const last = harness.notifications.at(-1);
      assert(last.message.includes("Unbekanntes Argument"), "reports the unknown argument");
      eq(calls, 0, "no request was made for an invalid invocation");
    },
  );
});

await test("reports 'no configured models' and does not crash when none exist", async () => {
  const harness = await runCommand(createHarness({ models: {} }), "");
  const last = harness.notifications.at(-1);
  assert(last.message.includes("Keine konfigurierten OpenRouter-Modelle"), "explains no models are configured");
});

await test("Quick Check on a healthy model reports HEALTHY and never logs the API key", async () => {
  await withFakeFetch(deepFetch, async () => {
    const harness = await runCommand(harnessWithModel(), "openai/gpt-oss-120b");
    const report = harness.notifications.at(-1).message;
    assert(report.includes("HEALTHY"), "reports HEALTHY");
    assert(!report.includes("test-key"), "never echoes the resolved API key");
  });
});

await test("Quick Check on a model missing from the catalog reports BROKEN with an explanation", async () => {
  await withFakeFetch(
    (url) => (String(url).endsWith("/models") ? jsonResponse(200, { data: [] }) : deepFetch(url)),
    async () => {
      const harness = await runCommand(harnessWithModel(), "openai/gpt-oss-120b");
      const report = harness.notifications.at(-1).message;
      assert(report.includes("BROKEN"), "reports BROKEN");
      assert(report.includes("nicht gefunden") || report.includes("nicht im OpenRouter-Katalog"), "explains why");
    },
  );
});

await test("reports authentication failure as BROKEN when no provider auth is configured at all", async () => {
  const harness = await runCommand(harnessWithModel({ models: {} }), "openai/gpt-oss-120b");
  const report = harness.notifications.at(-1).message;
  assert(report.includes("BROKEN"), "reports BROKEN");
  assert(report.includes("Authentifizierung"), "explains the authentication problem");
});

await test("Deep Check exercises tool calling, reasoning, strict routing and provider isolation, reporting DEGRADED", async () => {
  await withFakeFetch(deepFetch, async () => {
    const harness = await runCommand(harnessWithModel(), "openai/gpt-oss-120b --deep --details");
    const report = harness.notifications.at(-1).message;
    assert(report.includes("DEGRADED"), "model works overall but strict routing fails");
    assert(report.includes("Tool Calling"), "shows the tool-calling check");
    assert(report.includes("Reasoning"), "shows the reasoning check");
    assert(report.includes("Strict Pi compatibility"), "shows the strict-parameters check");
    assert(report.includes("together"), "provider diagnosis lists the working provider");
    assert(report.includes("deepinfra"), "provider diagnosis lists the failing provider");
    assert(!report.includes("test-key"), "still never echoes the API key, even with --details");
  });
});

const { passed, failed } = counters();
if (failed > 0) {
  console.error(`\nFAIL: ${passed} passed, ${failed} failed`);
  process.exit(1);
}
console.log(`PASS: ${passed} passed, 0 failed`);
