#!/usr/bin/env node
/**
 * Manual, opt-in live test against the real OpenRouter API.
 *
 * NOT part of `npm test` / `npm run verify` / any CI path — it costs real
 * tokens and needs a real key. Run it explicitly:
 *
 *   OPENROUTER_API_KEY=sk-or-... node tests/openrouter-doctor/live/manual-live-check.mjs
 *
 * Covers the cases from README "Live-Test-Voraussetzungen":
 *   Fall A — a currently working free model            → expect HEALTHY-ish
 *   Fall B — a deliberately invalid model id            → expect BROKEN / model-not-found
 *   Fall D — tool-calling test on the Fall A model
 *   Fall E — strict `provider.require_parameters` test on the Fall A model
 * Fall C (a model with a genuine provider problem) has no reliably
 * reproducible fixture and is not automated here — see README.
 */
import { importModule as load } from "../../shared/jiti-loader.mjs";

const API_KEY = process.env.OPENROUTER_API_KEY;
if (!API_KEY) {
  console.error(
    "OPENROUTER_API_KEY ist nicht gesetzt. Dieser Live-Test läuft nur mit einem explizit gesetzten, echten API-Key.",
  );
  process.exit(1);
}

const HEALTHY_MODEL = "openai/gpt-oss-20b:free";
const BROKEN_MODEL = "openai/definitely-not-a-real-model-xyz";

const { checkCatalog } = await load("extensions/openrouter-doctor/checks/catalog.ts");
const { checkAuth } = await load("extensions/openrouter-doctor/checks/auth.ts");
const { checkInference } = await load("extensions/openrouter-doctor/checks/inference.ts");
const { checkToolCalling } = await load("extensions/openrouter-doctor/checks/tools.ts");
const { checkStrictParameters } = await load("extensions/openrouter-doctor/checks/providers.ts");
const { createRequestGate, CircuitBreaker } = await load("extensions/openrouter-doctor/http.ts");
const { OPENROUTER_API_BASE_URL } = await load("extensions/openrouter-doctor/types.ts");

const deps = {
  baseUrl: OPENROUTER_API_BASE_URL,
  headers: { authorization: `Bearer ${API_KEY}`, "content-type": "application/json" },
  gate: createRequestGate(),
  breaker: new CircuitBreaker(),
  signal: new AbortController().signal,
};

function report(label, result) {
  console.log(`${label}: ${result.status}${result.summary ? ` — ${result.summary}` : ""}`);
}

console.log(`\n=== Fall A: ${HEALTHY_MODEL} (erwartet: funktioniert) ===`);
const catalogA = await checkCatalog(HEALTHY_MODEL, deps);
report("Catalog", catalogA);
const authA = await checkAuth(deps);
report("Auth", authA);
const inferenceA = authA.status === "ok" ? await checkInference(HEALTHY_MODEL, deps) : undefined;
if (inferenceA) report("Inference", inferenceA);

console.log(`\n=== Fall B: ${BROKEN_MODEL} (erwartet: BROKEN / model-not-found) ===`);
const catalogB = await checkCatalog(BROKEN_MODEL, deps);
report("Catalog", catalogB);

console.log(`\n=== Fall D: Tool Calling auf ${HEALTHY_MODEL} ===`);
const tools = await checkToolCalling(HEALTHY_MODEL, deps);
report("Tool Calling", tools);

console.log(`\n=== Fall E: Strict provider.require_parameters auf ${HEALTHY_MODEL} ===`);
const strict = await checkStrictParameters(HEALTHY_MODEL, inferenceA?.status === "ok", deps);
report("Strict Pi compatibility", strict);

console.log(
  "\nFall C (Modell mit echtem Providerproblem, DEGRADED) ist nicht automatisiert: kein reproduzierbares " +
    "Fixture verfügbar. Siehe README 'Live-Test-Voraussetzungen' für manuelles Vorgehen.",
);

console.log("\nHinweis: Es wurde keine Konfiguration geändert und kein API-Key ausgegeben.");
