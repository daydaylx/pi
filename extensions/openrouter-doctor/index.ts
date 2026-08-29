/**
 * OpenRouter Doctor: diagnoses configured OpenRouter models and explains
 * why they work, work partially, or fail — without ever changing model,
 * provider, or settings.json itself. See README.md for scope and limits.
 */
import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";
import { catalogDescription } from "../shared/command-catalog.ts";
import { checkAuth } from "./checks/auth.ts";
import { checkCapabilities } from "./checks/capabilities.ts";
import { checkCatalog } from "./checks/catalog.ts";
import { checkInference } from "./checks/inference.ts";
import { isolateProviders } from "./checks/provider-isolation.ts";
import { checkStrictParameters, listProviderEndpoints } from "./checks/providers.ts";
import { checkReasoningCompatibility } from "./checks/reasoning.ts";
import { checkToolCalling } from "./checks/tools.ts";
import { resolveOpenRouterAuth } from "./credentials.ts";
import { buildRecommendations } from "./diagnostics/recommendations.ts";
import { aggregateStatus } from "./diagnostics/status.ts";
import { CircuitBreaker, createRequestGate } from "./http.ts";
import { formatReport } from "./ui/report.ts";
import { pickOpenRouterModel } from "./ui/picker.ts";
import { STRINGS } from "./ui/strings.ts";
import type { CheckResult, DiagnosisReport } from "./types.ts";

// One breaker/gate per extension instance (module scope): shared across
// runs within a session, matching the documented 5-minute cool-down, and
// deliberately not persisted across sessions.
const breaker = new CircuitBreaker();
const gate = createRequestGate();

interface ParsedArgs {
  modelIdArg?: string;
  deep: boolean;
  details: boolean;
  error?: string;
}

function parseArgs(args: string): ParsedArgs {
  const tokens = args.trim().split(/\s+/).filter(Boolean);
  let modelIdArg: string | undefined;
  let deep = false;
  let details = false;
  for (const token of tokens) {
    if (token === "--deep") {
      deep = true;
    } else if (token === "--details") {
      details = true;
    } else if (token.startsWith("--")) {
      return { deep, details, error: STRINGS.unknownArgument(token) };
    } else if (modelIdArg === undefined) {
      modelIdArg = token;
    } else {
      return { deep, details, error: STRINGS.unknownArgument(token) };
    }
  }
  return { modelIdArg, deep, details };
}

function normalizeArgModelId(raw: string): string {
  return raw.startsWith("openrouter/") ? raw.slice("openrouter/".length) : raw;
}

function findAuthModel(ctx: ExtensionCommandContext, orModelId: string): Model<Api> | undefined {
  const exact = ctx.modelRegistry.find("openrouter", orModelId);
  if (exact) return exact;
  const anyOpenRouter = ctx.modelRegistry
    .getAvailable()
    .find((model) => model.provider === "openrouter");
  return anyOpenRouter;
}

async function resolveTarget(
  ctx: ExtensionCommandContext,
  modelIdArg: string | undefined,
): Promise<{ orModelId: string; authModel: Model<Api> | undefined } | undefined> {
  if (modelIdArg === undefined) {
    const picked = await pickOpenRouterModel(ctx);
    if (!picked) return undefined;
    return { orModelId: picked.id, authModel: picked };
  }
  const orModelId = normalizeArgModelId(modelIdArg);
  return { orModelId, authModel: findAuthModel(ctx, orModelId) };
}

interface RunDeps {
  baseUrl: string;
  headers: Record<string, string>;
  gate: ReturnType<typeof createRequestGate>;
  breaker: CircuitBreaker;
  signal: AbortSignal;
}

/** Runs the deep-only checks; skipped entirely on Quick Check or when Inference already failed. */
async function runDeepChecks(
  orModelId: string,
  entry: Parameters<typeof checkReasoningCompatibility>[1],
  inferenceOk: boolean,
  deps: RunDeps,
): Promise<CheckResult[]> {
  const checks: CheckResult[] = [];
  checks.push(await checkToolCalling(orModelId, deps));
  checks.push(await checkReasoningCompatibility(orModelId, entry, deps));
  const strict = await checkStrictParameters(orModelId, inferenceOk, deps);
  checks.push(strict);
  if (strict.status === "fail") {
    const endpoints = await listProviderEndpoints(orModelId, deps);
    checks.push(await isolateProviders(orModelId, endpoints, deps));
  }
  return checks;
}

async function runDiagnosis(
  ctx: ExtensionCommandContext,
  orModelId: string,
  authModel: Model<Api> | undefined,
  mode: "quick" | "deep",
  signal: AbortSignal,
): Promise<DiagnosisReport> {
  const auth = authModel
    ? await resolveOpenRouterAuth(ctx, authModel)
    : ({
        ok: false as const,
        error: {
          category: "authentication" as const,
          humanSummary: "OpenRouter ist als Provider in dieser Pi-Konfiguration nicht eingerichtet.",
          likelyCauses: ["Kein OpenRouter-Modell in settings.json konfiguriert"],
          recommendedAction: "Mindestens ein openrouter/-Modell konfigurieren, dann erneut prüfen.",
        },
      });

  const checks: CheckResult[] = [];
  const catalogDeps = { baseUrl: auth.ok ? auth.baseUrl : "https://openrouter.ai/api/v1", headers: auth.ok ? auth.headers : {}, gate, breaker, signal };
  const catalog = await checkCatalog(orModelId, catalogDeps);
  checks.push(catalog);
  const entry = catalog.data?.entry;
  checks.push(checkCapabilities(entry));

  if (!auth.ok) {
    checks.push({
      id: "auth",
      label: "Authentication",
      status: "fail",
      summary:
        auth.error.category === "configuration"
          ? "OpenRouter-Endpoint-Konfiguration abgelehnt."
          : "Authentifizierung fehlgeschlagen.",
      error: auth.error,
    });
    checks.push({ id: "inference", label: "Inference", status: "unknown", summary: "Übersprungen (Authentifizierung fehlgeschlagen)." });
  } else {
    const deps: RunDeps = { baseUrl: auth.baseUrl, headers: auth.headers, gate, breaker, signal };
    const authCheck = await checkAuth(deps);
    checks.push(authCheck);
    if (authCheck.status !== "ok") {
      checks.push({ id: "inference", label: "Inference", status: "unknown", summary: "Übersprungen (Authentifizierung fehlgeschlagen)." });
    } else {
      const inference = await checkInference(orModelId, deps);
      checks.push(inference);
      if (mode === "deep") {
        checks.push(...(await runDeepChecks(orModelId, entry, inference.status === "ok", deps)));
      }
    }
  }

  const status = aggregateStatus(checks);
  return {
    configuredModelId: `openrouter/${orModelId}`,
    orModelId,
    mode,
    status,
    checks,
    recommendations: buildRecommendations(checks),
    generatedAt: new Date().toISOString(),
  };
}

export default function openrouterDoctorExtension(pi: ExtensionAPI): void {
  pi.registerCommand("openrouter-doctor", {
    description: catalogDescription("openrouter-doctor"),
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const parsed = parseArgs(args);
      if (parsed.error) {
        ctx.ui.notify(`${parsed.error} ${STRINGS.usage}`, "error");
        return;
      }
      const target = await resolveTarget(ctx, parsed.modelIdArg);
      if (!target) return;

      const controller = new AbortController();
      ctx.ui.setStatus("openrouter-doctor", parsed.deep ? "Deep Check…" : "Quick Check…");
      ctx.ui.notify(parsed.deep ? STRINGS.runningDeep : STRINGS.runningQuick, "info");
      try {
        const report = await runDiagnosis(
          ctx,
          target.orModelId,
          target.authModel,
          parsed.deep ? "deep" : "quick",
          controller.signal,
        );
        const level = report.status === "HEALTHY" ? "info" : report.status === "DEGRADED" ? "warning" : "error";
        ctx.ui.notify(formatReport(report, { details: parsed.details }), level);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`OpenRouter Doctor: unerwarteter Fehler — ${message}`, "error");
      } finally {
        controller.abort();
        ctx.ui.setStatus("openrouter-doctor", undefined);
      }
    },
  });
}
