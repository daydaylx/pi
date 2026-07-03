/**
 * Pure logic for discovering and ranking free OpenRouter models.
 *
 * No filesystem or extension-API access here — everything is a plain
 * function over plain data so it can be unit-tested without mocking `pi`
 * or `ctx` (see tests/run.mjs).
 */

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const OPENROUTER_MODELS_URL = `${OPENROUTER_BASE_URL}/models`;

/** The router OpenRouter provides that auto-picks *some* free model per request. */
export const ROUTER_FREE_MODEL_ID = "openrouter/free";

// Below this, a model is excluded outright (not just deprioritized) — too
// small to hold a useful chunk of code/context for agent work.
export const DEFAULT_MIN_CONTEXT_LENGTH = 16_000;
// Context tiers used for grouping.
export const FAST_SMALL_CONTEXT_CEILING = 32_000;
export const LARGE_CONTEXT_FLOOR = 131_072;
// Models newer than this are flagged as freshly added / unproven.
export const FRESH_MODEL_DAYS = 14;

export interface OpenRouterPricing {
  prompt?: string;
  completion?: string;
  request?: string;
  image?: string;
  audio?: string;
  web_search?: string;
  internal_reasoning?: string;
  input_cache_read?: string;
  input_cache_write?: string;
  input_cache_write_1h?: string;
  [key: string]: string | undefined;
}

export interface OpenRouterArchitecture {
  modality?: string;
  input_modalities?: string[];
  output_modalities?: string[];
  tokenizer?: string;
  instruct_type?: string | null;
}

export interface OpenRouterTopProvider {
  context_length?: number | null;
  max_completion_tokens?: number | null;
  is_moderated?: boolean;
}

export interface OpenRouterModel {
  id: string;
  name?: string;
  created?: number;
  description?: string;
  context_length?: number | null;
  architecture?: OpenRouterArchitecture;
  pricing?: OpenRouterPricing;
  top_provider?: OpenRouterTopProvider;
  supported_parameters?: string[];
  expiration_date?: string | null;
}

export interface OpenRouterModelsResponse {
  data: OpenRouterModel[];
}

export type ModelGroup =
  "recommended" | "large-context" | "fast-small" | "experimental" | "no-tools";

export const GROUP_ORDER: readonly ModelGroup[] = [
  "recommended",
  "large-context",
  "fast-small",
  "experimental",
  "no-tools",
];

export const GROUP_LABELS: Record<ModelGroup, string> = {
  recommended: "Empfohlen für Coding",
  "large-context": "Große Kontextfenster",
  "fast-small": "Schnelle kleine Modelle",
  experimental: "Experimentell / instabil",
  "no-tools": "Ohne Tool-Support",
};

export interface FreeModelEntry {
  id: string;
  name: string;
  contextLength: number;
  maxCompletionTokens: number | undefined;
  inputModalities: string[];
  supportsTools: boolean;
  supportsReasoning: boolean;
  expirationDate: string | null;
  createdAt: number | undefined;
  group: ModelGroup;
  warnings: string[];
}

export interface FetchLike {
  (
    url: string,
    init?: { headers?: Record<string, string> },
  ): Promise<{
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
  }>;
}

export async function fetchOpenRouterModels(
  fetchImpl: FetchLike = fetch,
): Promise<OpenRouterModel[]> {
  const response = await fetchImpl(OPENROUTER_MODELS_URL, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(
      `OpenRouter Models API antwortete mit Status ${response.status}`,
    );
  }
  const body = (await response.json()) as OpenRouterModelsResponse;
  if (!body || !Array.isArray(body.data)) {
    throw new Error("Unerwartetes Antwortformat von der OpenRouter Models API");
  }
  return body.data;
}

function priceIsZero(value: string | undefined): boolean {
  if (value === undefined || value === null || value === "") return true;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric <= 0 : false;
}

/** prompt/completion must be free, and no other pricing dimension may carry a real cost. */
export function isFreeModel(model: OpenRouterModel): boolean {
  const pricing = model.pricing;
  if (!pricing) return false;
  if (!priceIsZero(pricing.prompt) || !priceIsZero(pricing.completion))
    return false;
  return Object.entries(pricing)
    .filter(([key]) => key !== "prompt" && key !== "completion")
    .every(([, value]) => priceIsZero(value));
}

/** Excludes vision/image/audio-output-only models; text output is required for coding chat. */
export function isTextCapable(model: OpenRouterModel): boolean {
  const output = model.architecture?.output_modalities;
  if (!output || output.length === 0) return true;
  return output.length === 1 && output[0] === "text";
}

export function hasToolSupport(model: OpenRouterModel): boolean {
  return model.supported_parameters?.includes("tools") ?? false;
}

export function hasReasoningSupport(model: OpenRouterModel): boolean {
  const params = model.supported_parameters;
  if (!params) return false;
  return params.includes("reasoning") || params.includes("include_reasoning");
}

export function resolveContextLength(model: OpenRouterModel): number {
  return model.context_length ?? model.top_provider?.context_length ?? 0;
}

function isFreshModel(model: OpenRouterModel, now: Date): boolean {
  if (typeof model.created !== "number") return false;
  const ageMs = now.getTime() - model.created * 1000;
  return ageMs >= 0 && ageMs < FRESH_MODEL_DAYS * 24 * 60 * 60 * 1000;
}

function classify(
  model: OpenRouterModel,
  contextLength: number,
  tools: boolean,
  expiring: boolean,
  fresh: boolean,
): ModelGroup {
  if (model.id === ROUTER_FREE_MODEL_ID || expiring) return "experimental";
  if (fresh) return "experimental";
  if (!tools) return "no-tools";
  if (contextLength >= LARGE_CONTEXT_FLOOR) return "large-context";
  if (contextLength < FAST_SMALL_CONTEXT_CEILING) return "fast-small";
  return "recommended";
}

function buildWarnings(
  model: OpenRouterModel,
  tools: boolean,
  contextLength: number,
  expiring: boolean,
  fresh: boolean,
): string[] {
  const warnings: string[] = [];
  if (model.id === ROUTER_FREE_MODEL_ID) {
    warnings.push(
      "Zufällige Modellwahl durch OpenRouter — Ergebnis nicht reproduzierbar",
    );
  }
  if (expiring) warnings.push(`Läuft ab: ${model.expiration_date}`);
  if (fresh) warnings.push("Frisch hinzugefügt — Stabilität ungeprüft");
  if (!tools) warnings.push("Kein Tool-Support");
  if (contextLength < FAST_SMALL_CONTEXT_CEILING)
    warnings.push("Kleiner Kontext");
  return warnings;
}

export interface FreeModelListOptions {
  minContextLength?: number;
  includeRouterFree?: boolean;
  now?: Date;
}

/**
 * Filters the raw OpenRouter catalog down to free, text-capable, usable-context
 * models and classifies each into a UX group. Deterministic and side-effect-free.
 */
export function buildFreeModelList(
  models: OpenRouterModel[],
  options: FreeModelListOptions = {},
): FreeModelEntry[] {
  const minContextLength =
    options.minContextLength ?? DEFAULT_MIN_CONTEXT_LENGTH;
  const includeRouterFree = options.includeRouterFree ?? true;
  const now = options.now ?? new Date();

  const entries: FreeModelEntry[] = [];
  for (const model of models) {
    if (!isFreeModel(model)) continue;
    if (!isTextCapable(model)) continue;
    if (model.id === ROUTER_FREE_MODEL_ID && !includeRouterFree) continue;

    const contextLength = resolveContextLength(model);
    if (contextLength < minContextLength) continue;

    const tools = hasToolSupport(model);
    const reasoning = hasReasoningSupport(model);
    const expiring = Boolean(model.expiration_date);
    const fresh = isFreshModel(model, now);

    entries.push({
      id: model.id,
      name: model.name ?? model.id,
      contextLength,
      maxCompletionTokens:
        model.top_provider?.max_completion_tokens ?? undefined,
      inputModalities: model.architecture?.input_modalities ?? ["text"],
      supportsTools: tools,
      supportsReasoning: reasoning,
      expirationDate: model.expiration_date ?? null,
      createdAt: model.created,
      group: classify(model, contextLength, tools, expiring, fresh),
      warnings: buildWarnings(model, tools, contextLength, expiring, fresh),
    });
  }

  const groupRank = new Map(GROUP_ORDER.map((group, index) => [group, index]));
  entries.sort((a, b) => {
    const groupDelta =
      (groupRank.get(a.group) ?? 99) - (groupRank.get(b.group) ?? 99);
    if (groupDelta !== 0) return groupDelta;
    if (a.id === ROUTER_FREE_MODEL_ID) return -1;
    if (b.id === ROUTER_FREE_MODEL_ID) return 1;
    return b.contextLength - a.contextLength;
  });
  return entries;
}

export function formatContextLength(n: number): string {
  if (n >= 1_000_000) {
    const millions = n / 1_000_000;
    return `${millions % 1 === 0 ? millions.toFixed(0) : millions.toFixed(1)}M ctx`;
  }
  if (n >= 1000) return `${Math.round(n / 1000)}K ctx`;
  return `${n} ctx`;
}

export function formatSelectLabel(entry: FreeModelEntry): string {
  const tools = entry.supportsTools ? "tools" : "keine tools";
  const reasoning = entry.supportsReasoning ? ", reasoning" : "";
  const warn = entry.warnings.length > 0 ? " ⚠" : "";
  return `[${GROUP_LABELS[entry.group]}] ${entry.id} — ${formatContextLength(entry.contextLength)}, ${tools}${reasoning}${warn}`;
}

const RATE_LIMIT_NOTE =
  "Hinweis: Kostenlose OpenRouter-Modelle können Rate-Limits, Latenz-Schwankungen oder kurzfristige Nichtverfügbarkeit haben.";

export function formatFreeModelList(
  entries: FreeModelEntry[],
  fetchedAt: string,
): string {
  const lines: string[] = [`OpenRouter Free Models (Stand ${fetchedAt})`, ""];

  for (const group of GROUP_ORDER) {
    const groupEntries = entries.filter((entry) => entry.group === group);
    if (groupEntries.length === 0) continue;

    lines.push(`${GROUP_LABELS[group]}:`);
    for (const entry of groupEntries) {
      const tools = entry.supportsTools ? "tools" : "keine tools";
      const reasoning = entry.supportsReasoning ? ", reasoning" : "";
      const warn =
        entry.warnings.length > 0 ? ` — ⚠ ${entry.warnings.join("; ")}` : "";
      lines.push(
        `  ${entry.id} — ${formatContextLength(entry.contextLength)}, ${tools}${reasoning}${warn}`,
      );
    }
    lines.push("");
  }

  lines.push(RATE_LIMIT_NOTE);
  return lines.join("\n").trimEnd();
}
