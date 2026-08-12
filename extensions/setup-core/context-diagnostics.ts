export interface ContextDiagnosticTool {
  name: unknown;
  parameters?: unknown;
}

export interface ContextUsageSnapshot {
  tokens?: number | null;
  contextWindow?: number | null;
  percent?: number | null;
}

export interface ContextDiagnosticInput {
  registeredTools: readonly ContextDiagnosticTool[];
  activeToolNames: readonly unknown[];
  systemPrompt?: string;
  sessionEntries: readonly unknown[];
  activeContext?: ContextUsageSnapshot;
  model?: { provider?: unknown; id?: unknown; contextWindow?: unknown } | null;
  compaction?: {
    enabled?: boolean;
    reserveTokens?: number;
    keepRecentTokens?: number;
  };
}

export interface UsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface ToolTruncationTotals {
  count: number;
  totalBytes: number;
  outputBytes: number;
}

export interface CompactionAttempt {
  timestamp: string;
  boundary: "started" | "completed" | "failed";
  reason?: string;
  errorMessage?: string;
}

export interface ContextDiagnostics {
  registeredToolNames: string[];
  activeToolNames: string[];
  schemaBytes: number;
  systemPromptBytes: number | null;
  activeContext: ContextUsageSnapshot | null;
  model: string | null;
  compaction: Required<NonNullable<ContextDiagnosticInput["compaction"]>>;
  lifetimeUsage: UsageTotals | null;
  compactionTimestamps: string[];
  lastCompactionAttempt: CompactionAttempt | null;
  toolTruncation: ToolTruncationTotals;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function names(values: readonly unknown[]): string[] {
  return [
    ...new Set(
      values.filter((value): value is string => typeof value === "string"),
    ),
  ].sort((left, right) => left.localeCompare(right));
}

function stableJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number")
    return Number.isFinite(value) ? String(value) : "null";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (!isRecord(value)) return "null";
  return `{${Object.keys(value)
    .sort((left, right) => left.localeCompare(right))
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
    .join(",")}}`;
}

function readUsage(value: unknown): UsageTotals | undefined {
  if (!isRecord(value)) return undefined;
  const fields = ["input", "output", "cacheRead", "cacheWrite"] as const;
  if (
    !fields.every(
      (field) =>
        typeof value[field] === "number" && Number.isFinite(value[field]),
    )
  )
    return undefined;
  return {
    input: value.input as number,
    output: value.output as number,
    cacheRead: value.cacheRead as number,
    cacheWrite: value.cacheWrite as number,
  };
}

function usageFromEntry(entry: unknown): UsageTotals | undefined {
  if (!isRecord(entry)) return undefined;
  const direct = readUsage(entry.usage);
  if (direct) return direct;
  return isRecord(entry.message) ? readUsage(entry.message.usage) : undefined;
}

function truncationFromEntry(
  entry: unknown,
): { totalBytes: number; outputBytes: number } | undefined {
  if (
    !isRecord(entry) ||
    !isRecord(entry.message) ||
    entry.message.role !== "toolResult"
  )
    return undefined;
  const details = entry.message.details;
  if (
    !isRecord(details) ||
    !isRecord(details.truncation) ||
    details.truncation.truncated !== true
  )
    return undefined;
  const totalBytes = details.truncation.totalBytes;
  const outputBytes = details.truncation.outputBytes;
  if (typeof totalBytes !== "number" || !Number.isFinite(totalBytes))
    return undefined;
  return {
    totalBytes,
    outputBytes:
      typeof outputBytes === "number" && Number.isFinite(outputBytes)
        ? outputBytes
        : 0,
  };
}

function compactionAttemptFromEntry(
  entry: unknown,
): CompactionAttempt | undefined {
  if (!isRecord(entry) || entry.type !== "custom") return undefined;
  if (
    entry.customType !== "resilience.compaction-boundary" ||
    !isRecord(entry.data)
  )
    return undefined;
  const boundary = entry.data.boundary;
  const timestamp = entry.data.timestamp;
  if (
    (boundary !== "started" &&
      boundary !== "completed" &&
      boundary !== "failed") ||
    typeof timestamp !== "string"
  )
    return undefined;
  return {
    timestamp,
    boundary,
    ...(typeof entry.data.reason === "string"
      ? { reason: entry.data.reason }
      : {}),
    ...(typeof entry.data.errorMessage === "string"
      ? { errorMessage: entry.data.errorMessage }
      : {}),
  };
}

function modelName(model: ContextDiagnosticInput["model"]): string | null {
  if (
    !model ||
    typeof model.provider !== "string" ||
    typeof model.id !== "string"
  )
    return null;
  return `${model.provider}/${model.id}`;
}

/**
 * Reads aggregate session metadata and the runtime's compaction-aware context
 * snapshot. Lifetime usage is deliberately not repurposed as request context.
 */
export function collectContextDiagnostics(
  input: ContextDiagnosticInput,
): ContextDiagnostics {
  const registered = input.registeredTools
    .filter(
      (tool): tool is { name: string; parameters?: unknown } =>
        typeof tool.name === "string",
    )
    .sort((left, right) => left.name.localeCompare(right.name));
  const registeredToolNames = names(registered.map((tool) => tool.name));
  const activeToolNames = names(input.activeToolNames);
  const activeSet = new Set(activeToolNames);
  const schemaBytes = Buffer.byteLength(
    stableJson(
      registered
        .filter((tool) => activeSet.has(tool.name))
        .map((tool) => ({
          name: tool.name,
          parameters: tool.parameters ?? null,
        })),
    ),
    "utf8",
  );

  let lifetimeUsage: UsageTotals | undefined;
  const compactionTimestamps: string[] = [];
  let lastCompactionAttempt: CompactionAttempt | undefined;
  const toolTruncation: ToolTruncationTotals = {
    count: 0,
    totalBytes: 0,
    outputBytes: 0,
  };
  for (const entry of input.sessionEntries) {
    const entryUsage = usageFromEntry(entry);
    if (entryUsage) {
      lifetimeUsage ??= { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
      lifetimeUsage.input += entryUsage.input;
      lifetimeUsage.output += entryUsage.output;
      lifetimeUsage.cacheRead += entryUsage.cacheRead;
      lifetimeUsage.cacheWrite += entryUsage.cacheWrite;
    }
    if (
      isRecord(entry) &&
      entry.type === "compaction" &&
      typeof entry.timestamp === "string"
    )
      compactionTimestamps.push(entry.timestamp);
    const attempt = compactionAttemptFromEntry(entry);
    if (attempt) lastCompactionAttempt = attempt;
    const truncation = truncationFromEntry(entry);
    if (truncation) {
      toolTruncation.count += 1;
      toolTruncation.totalBytes += truncation.totalBytes;
      toolTruncation.outputBytes += truncation.outputBytes;
    }
  }

  const contextWindow =
    typeof input.activeContext?.contextWindow === "number"
      ? input.activeContext.contextWindow
      : typeof input.model?.contextWindow === "number"
        ? input.model.contextWindow
        : null;
  const activeTokens = input.activeContext?.tokens;
  const activePercent = input.activeContext?.percent;
  const activeContext =
    contextWindow !== null ||
    activeTokens !== undefined ||
    activePercent !== undefined
      ? {
          tokens: typeof activeTokens === "number" ? activeTokens : null,
          contextWindow,
          percent: typeof activePercent === "number" ? activePercent : null,
        }
      : null;

  return {
    registeredToolNames,
    activeToolNames,
    schemaBytes,
    systemPromptBytes:
      typeof input.systemPrompt === "string"
        ? Buffer.byteLength(input.systemPrompt, "utf8")
        : null,
    activeContext,
    model: modelName(input.model),
    compaction: {
      enabled: input.compaction?.enabled ?? true,
      reserveTokens: input.compaction?.reserveTokens ?? 16384,
      keepRecentTokens: input.compaction?.keepRecentTokens ?? 20000,
    },
    lifetimeUsage: lifetimeUsage ?? null,
    compactionTimestamps,
    lastCompactionAttempt: lastCompactionAttempt ?? null,
    toolTruncation,
  };
}

function formatNumber(value: number | null | undefined): string {
  return typeof value === "number" ? String(value) : "n/a";
}

export function formatContextDiagnostics(
  diagnostics: ContextDiagnostics,
): string {
  const namesOrNone = (names: readonly string[]) => names.join(", ") || "keine";
  const lifetimeUsage = diagnostics.lifetimeUsage
    ? `input=${diagnostics.lifetimeUsage.input}, output=${diagnostics.lifetimeUsage.output}, cacheRead=${diagnostics.lifetimeUsage.cacheRead}, cacheWrite=${diagnostics.lifetimeUsage.cacheWrite}`
    : "n/a";
  const contextWindow = diagnostics.activeContext?.contextWindow;
  const trigger =
    typeof contextWindow === "number"
      ? contextWindow - diagnostics.compaction.reserveTokens
      : null;
  const active = diagnostics.activeContext;
  const activeSource =
    active?.tokens === null
      ? "pending fresh usage (runtime reports no post-compaction usage)"
      : active
        ? "compaction-aware runtime usage/estimate"
        : "unavailable from runtime";
  const lastSuccessful = diagnostics.compactionTimestamps.at(-1) ?? "keine";
  const attempt = diagnostics.lastCompactionAttempt
    ? `${diagnostics.lastCompactionAttempt.timestamp} (${diagnostics.lastCompactionAttempt.boundary}${diagnostics.lastCompactionAttempt.reason ? `, ${diagnostics.lastCompactionAttempt.reason}` : ""}${diagnostics.lastCompactionAttempt.errorMessage ? `: ${diagnostics.lastCompactionAttempt.errorMessage}` : ""})`
    : "nicht zugänglich";
  return [
    "Setup Doctor: Context",
    `  Model: ${diagnostics.model ?? "n/a"}`,
    `  Context Window: ${formatNumber(active?.contextWindow)}`,
    `  Active Context Tokens: ${formatNumber(active?.tokens)}`,
    `  Active Context Percent: ${active?.percent === null || active?.percent === undefined ? "n/a" : `${active.percent.toFixed(2)}%`}`,
    `  Compaction Trigger: ${formatNumber(trigger)}`,
    `  Reserve Tokens: ${diagnostics.compaction.reserveTokens}`,
    `  Keep Recent Tokens: ${diagnostics.compaction.keepRecentTokens}`,
    `  Compaction Enabled: ${diagnostics.compaction.enabled}`,
    `  Usage Source: ${activeSource}`,
    `  effective system prompt: ${diagnostics.systemPromptBytes ?? "n/a"} bytes`,
    `  active tool schemas: ${diagnostics.schemaBytes} bytes (deterministic)`,
    `  registered tools: ${diagnostics.registeredToolNames.length} (${namesOrNone(diagnostics.registeredToolNames)})`,
    `  active tools: ${diagnostics.activeToolNames.length} (${namesOrNone(diagnostics.activeToolNames)})`,
    `  Last Successful Compaction: ${lastSuccessful}`,
    `  Last Compaction Attempt: ${attempt}`,
    `  Lifetime Usage: ${lifetimeUsage}`,
    `  persisted tool truncations: count=${diagnostics.toolTruncation.count}, totalBytes=${diagnostics.toolTruncation.totalBytes}, outputBytes=${diagnostics.toolTruncation.outputBytes}`,
  ].join("\n");
}
