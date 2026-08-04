export interface ContextDiagnosticTool {
  name: unknown;
  parameters?: unknown;
}

export interface ContextDiagnosticInput {
  registeredTools: readonly ContextDiagnosticTool[];
  activeToolNames: readonly unknown[];
  systemPrompt?: string;
  sessionEntries: readonly unknown[];
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

export interface ContextDiagnostics {
  registeredToolNames: string[];
  activeToolNames: string[];
  schemaBytes: number;
  systemPromptBytes: number | null;
  usage: UsageTotals | null;
  compactionTimestamps: string[];
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

/**
 * Reads only aggregate, already-persisted session metadata. It never retains
 * prompt text, tool content, or a copy of a session entry.
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
  const schemaBytes = Buffer.byteLength(
    stableJson(
      registered.map((tool) => ({
        name: tool.name,
        parameters: tool.parameters ?? null,
      })),
    ),
    "utf8",
  );

  let usage: UsageTotals | undefined;
  const compactionTimestamps: string[] = [];
  const toolTruncation: ToolTruncationTotals = {
    count: 0,
    totalBytes: 0,
    outputBytes: 0,
  };
  for (const entry of input.sessionEntries) {
    const entryUsage = usageFromEntry(entry);
    if (entryUsage) {
      usage ??= { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
      usage.input += entryUsage.input;
      usage.output += entryUsage.output;
      usage.cacheRead += entryUsage.cacheRead;
      usage.cacheWrite += entryUsage.cacheWrite;
    }
    if (
      isRecord(entry) &&
      entry.type === "compaction" &&
      typeof entry.timestamp === "string"
    )
      compactionTimestamps.push(entry.timestamp);
    const truncation = truncationFromEntry(entry);
    if (truncation) {
      toolTruncation.count += 1;
      toolTruncation.totalBytes += truncation.totalBytes;
      toolTruncation.outputBytes += truncation.outputBytes;
    }
  }

  return {
    registeredToolNames,
    activeToolNames,
    schemaBytes,
    systemPromptBytes:
      typeof input.systemPrompt === "string"
        ? Buffer.byteLength(input.systemPrompt, "utf8")
        : null,
    usage: usage ?? null,
    compactionTimestamps,
    toolTruncation,
  };
}

export function formatContextDiagnostics(
  diagnostics: ContextDiagnostics,
): string {
  const namesOrNone = (names: readonly string[]) => names.join(", ") || "keine";
  const usage = diagnostics.usage
    ? `input=${diagnostics.usage.input}, output=${diagnostics.usage.output}, cacheRead=${diagnostics.usage.cacheRead}, cacheWrite=${diagnostics.usage.cacheWrite}`
    : "n/a";
  const compactions = diagnostics.compactionTimestamps.length
    ? diagnostics.compactionTimestamps.join(", ")
    : "keine";
  return [
    "Setup Doctor: Context",
    `  registered tools: ${diagnostics.registeredToolNames.length} (${namesOrNone(diagnostics.registeredToolNames)})`,
    `  active tools: ${diagnostics.activeToolNames.length} (${namesOrNone(diagnostics.activeToolNames)})`,
    `  tool schemas: ${diagnostics.schemaBytes} bytes (deterministic)`,
    `  effective system prompt: ${diagnostics.systemPromptBytes ?? "n/a"} bytes`,
    `  real usage: ${usage}`,
    `  persisted compactions: ${diagnostics.compactionTimestamps.length} (${compactions})`,
    `  persisted tool truncations: count=${diagnostics.toolTruncation.count}, totalBytes=${diagnostics.toolTruncation.totalBytes}, outputBytes=${diagnostics.toolTruncation.outputBytes}`,
  ].join("\n");
}
