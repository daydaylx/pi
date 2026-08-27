import { assert, counters, test } from "../../shared/assertions.mjs";
import { importModule as load } from "../../shared/jiti-loader.mjs";

const { formatReport } = await load("extensions/openrouter-doctor/ui/report.ts");
const { normalizeError } = await load("extensions/openrouter-doctor/diagnostics/normalize-error.ts");

function baseReport(overrides = {}) {
  return {
    configuredModelId: "openrouter/openai/gpt-oss-120b",
    orModelId: "openai/gpt-oss-120b",
    mode: "quick",
    status: "HEALTHY",
    checks: [
      { id: "catalog", label: "Catalog", status: "ok", summary: "Modell im Katalog verfügbar." },
      { id: "auth", label: "Authentication", status: "ok", summary: "Authentifizierung funktioniert." },
      { id: "inference", label: "Inference", status: "ok", summary: "Modell antwortet auf Anfragen." },
    ],
    recommendations: [],
    generatedAt: "2026-08-27T00:00:00.000Z",
    ...overrides,
  };
}

await test("formatReport includes model id and status", () => {
  const text = formatReport(baseReport());
  assert(text.includes("openrouter/openai/gpt-oss-120b"), "shows the fully-qualified model id");
  assert(text.includes("HEALTHY"), "shows the status");
  assert(text.includes("Es wurde keine Konfiguration geändert."), "states nothing was changed");
});

await test("formatReport never renders a raw stack trace by default", () => {
  let thrown;
  try {
    throw new Error("boom");
  } catch (error) {
    thrown = error;
  }
  const report = baseReport({
    status: "BROKEN",
    checks: [
      {
        id: "catalog",
        label: "Catalog",
        status: "fail",
        summary: "Modell-ID nicht gefunden.",
        error: normalizeError({ kind: "http", status: 404, message: thrown.stack }),
      },
    ],
  });
  const text = formatReport(report);
  assert(!text.includes("at Object.<anonymous>"), "no Node stack frame text leaks into the default report");
});

await test("formatReport never includes Authorization headers or key material", () => {
  const report = baseReport({
    status: "BROKEN",
    checks: [
      {
        id: "auth",
        label: "Authentication",
        status: "fail",
        summary: "Authentifizierung fehlgeschlagen.",
        error: normalizeError({ kind: "http", status: 401, message: "No auth credentials found" }),
      },
    ],
  });
  const text = formatReport(report, { details: true });
  assert(!/authorization:/i.test(text), "no Authorization header line");
  assert(!/bearer\s+sk-/i.test(text), "no bearer key material");
});

await test("formatReport shows technical details only when requested", () => {
  const report = baseReport({
    status: "BROKEN",
    checks: [
      {
        id: "catalog",
        label: "Catalog",
        status: "fail",
        summary: "Modell-ID nicht gefunden.",
        error: normalizeError({ kind: "http", status: 404, code: "model_not_found", message: "not found" }),
      },
    ],
  });
  const withoutDetails = formatReport(report);
  const withDetails = formatReport(report, { details: true });
  assert(!withoutDetails.includes("Technisch:"), "no technical line by default");
  assert(withDetails.includes("Technisch:"), "technical line present with --details");
});

await test("formatReport renders provider diagnosis entries when present", () => {
  const report = baseReport({
    status: "DEGRADED",
    checks: [
      ...baseReport().checks,
      {
        id: "providers",
        label: "Provider diagnosis",
        status: "warn",
        summary: "1/2 geprüfte Provider kompatibel.",
        data: [
          { providerName: "together", status: "ok", summary: "Kompatibel." },
          { providerName: "deepinfra", status: "fail", summary: "529 – Upstream-Provider überlastet." },
        ],
      },
    ],
  });
  const text = formatReport(report);
  assert(text.includes("together"), "lists the working provider");
  assert(text.includes("deepinfra"), "lists the failing provider");
  assert(text.includes("Provider diagnosis"), "has a provider diagnosis section");
});

await test("formatReport lists recommendations when present, otherwise says none are needed", () => {
  const healthy = formatReport(baseReport());
  assert(healthy.includes("Keine Empfehlung nötig."), "no recommendations for a healthy report");
  const degraded = formatReport(baseReport({ status: "DEGRADED", recommendations: ["Später erneut versuchen."] }));
  assert(degraded.includes("- Später erneut versuchen."), "renders recommendation bullets");
});

const { passed, failed } = counters();
if (failed > 0) {
  console.error(`\nFAIL: ${passed} passed, ${failed} failed`);
  process.exit(1);
}
console.log(`PASS: ${passed} passed, 0 failed`);
