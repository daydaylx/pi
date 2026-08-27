/**
 * Live catalog check: does the configured model id actually exist on
 * OpenRouter right now? Pi's bundled model metadata is a build-time
 * snapshot and can be stale, so this always makes a fresh request instead
 * of trusting `Model<Api>` alone.
 */
import { createRequestGate, orFetchJson, type CircuitBreaker } from "../http.ts";
import { normalizeError } from "../diagnostics/normalize-error.ts";
import type { CatalogEntry, CheckResult } from "../types.ts";

const MAX_SUGGESTIONS = 3;

export interface CatalogCheckData {
  entry: CatalogEntry;
  allEntries: CatalogEntry[];
}

interface CatalogRequestDeps {
  baseUrl: string;
  headers: Record<string, string>;
  gate: ReturnType<typeof createRequestGate>;
  breaker: CircuitBreaker;
  signal: AbortSignal;
}

function levenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const distances: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i += 1) distances[i]![0] = i;
  for (let j = 0; j < cols; j += 1) distances[0]![j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      distances[i]![j] = Math.min(
        distances[i - 1]![j]! + 1,
        distances[i]![j - 1]! + 1,
        distances[i - 1]![j - 1]! + cost,
      );
    }
  }
  return distances[rows - 1]![cols - 1]!;
}

/** Nearest catalog ids by edit distance — informational only, never auto-applied. */
export function suggestSimilarModelIds(
  entries: readonly CatalogEntry[],
  orModelId: string,
  limit = MAX_SUGGESTIONS,
): string[] {
  return entries
    .map((entry) => ({ id: entry.id, distance: levenshtein(entry.id, orModelId) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit)
    .filter((candidate) => candidate.distance <= Math.max(4, Math.floor(orModelId.length / 2)))
    .map((candidate) => candidate.id);
}

export function findModelInCatalog(
  entries: readonly CatalogEntry[],
  orModelId: string,
): CatalogEntry | undefined {
  return entries.find((entry) => entry.id === orModelId);
}

function parseCatalogEntries(json: unknown): CatalogEntry[] {
  const data = (json as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  return data.filter(
    (entry): entry is CatalogEntry => typeof entry === "object" && entry !== null && typeof (entry as CatalogEntry).id === "string",
  );
}

/** GET /models is public — this check runs even when authentication failed. */
export async function checkCatalog(
  orModelId: string,
  deps: CatalogRequestDeps,
): Promise<CheckResult<CatalogCheckData>> {
  const result = await orFetchJson(`${deps.baseUrl}/models`, { headers: deps.headers }, deps);
  if (!result.ok) {
    const error = normalizeError(result.error);
    return { id: "catalog", label: "Catalog", status: "unknown", summary: "Katalog konnte nicht geladen werden.", error };
  }
  const allEntries = parseCatalogEntries(result.json);
  const entry = findModelInCatalog(allEntries, orModelId);
  if (!entry) {
    const suggestions = suggestSimilarModelIds(allEntries, orModelId);
    return {
      id: "catalog",
      label: "Catalog",
      status: "fail",
      summary:
        suggestions.length > 0
          ? `Modell-ID nicht gefunden. Ähnliche verfügbare IDs: ${suggestions.join(", ")}`
          : "Modell-ID nicht im OpenRouter-Katalog gefunden.",
      error: normalizeError({ kind: "http", status: 404, message: "model not found in catalog" }),
    };
  }
  return { id: "catalog", label: "Catalog", status: "ok", summary: "Modell im Katalog verfügbar.", data: { entry, allEntries } };
}
