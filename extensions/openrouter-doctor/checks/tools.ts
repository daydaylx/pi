/** Deep check: does the model actually emit a structured tool call, not just text? */
import { orFetchJson, type CircuitBreaker } from "../http.ts";
import { normalizeError } from "../diagnostics/normalize-error.ts";
import type { CheckResult } from "../types.ts";

interface ToolsCheckDeps {
  baseUrl: string;
  headers: Record<string, string>;
  gate: ReturnType<typeof import("../http.ts").createRequestGate>;
  breaker: CircuitBreaker;
  signal: AbortSignal;
}

const TEST_TOOL = {
  type: "function",
  function: {
    name: "test_tool",
    description: "Harmless diagnostic tool used only to verify tool-calling support.",
    parameters: {
      type: "object",
      properties: { value: { type: "string" } },
      required: ["value"],
    },
  },
} as const;

interface ToolCall {
  function?: { name?: string; arguments?: string };
}
interface ToolCallResponse {
  choices?: Array<{ message?: { content?: string | null; tool_calls?: ToolCall[] } }>;
}

function classifyToolCall(json: unknown): { status: "ok" | "warn" | "fail"; summary: string } {
  const message = (json as ToolCallResponse).choices?.[0]?.message;
  const toolCalls = message?.tool_calls ?? [];
  if (toolCalls.length === 0) {
    return {
      status: "fail",
      summary:
        "Das Modell hat normalen Text statt eines Tool Calls zurückgegeben. Nicht empfohlen als Pi-Hauptmodell; weiterhin nutzbar für Textgenerierung oder Recherche ohne Tools.",
    };
  }
  const call = toolCalls[0]!;
  if (call.function?.name !== "test_tool") {
    return { status: "warn", summary: `Tool Call erzeugt, aber falscher Toolname: ${call.function?.name ?? "unbekannt"}.` };
  }
  try {
    const args = JSON.parse(call.function.arguments ?? "{}") as { value?: unknown };
    if (typeof args.value !== "string") {
      return { status: "warn", summary: "Tool Call erzeugt, aber Argumente entsprechen nicht dem erwarteten Schema." };
    }
  } catch {
    return { status: "warn", summary: "Tool Call erzeugt, aber Argumente sind kein gültiges JSON (malformed arguments)." };
  }
  return { status: "ok", summary: "Tool Calling funktioniert." };
}

export async function checkToolCalling(orModelId: string, deps: ToolsCheckDeps): Promise<CheckResult> {
  const body = {
    model: orModelId,
    messages: [{ role: "user", content: 'Call test_tool with value "OK".' }],
    tools: [TEST_TOOL],
    tool_choice: "required",
    max_tokens: 64,
  };
  const result = await orFetchJson(
    `${deps.baseUrl}/chat/completions`,
    { method: "POST", headers: deps.headers, body: JSON.stringify(body) },
    deps,
  );
  if (!result.ok) {
    return {
      id: "tools",
      label: "Tool Calling",
      status: "fail",
      summary: "Tool-Calling-Request fehlgeschlagen.",
      error: normalizeError(result.error),
    };
  }
  const classification = classifyToolCall(result.json);
  return { id: "tools", label: "Tool Calling", ...classification };
}
