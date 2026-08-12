import type { ToolResultEvent } from "@earendil-works/pi-coding-agent";
import { limitSubagentOutput } from "../shared/output-limits.ts";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Removes report copies that are useful in child artifacts but unnecessarily
 * persist alongside the model-facing, bounded tool result in the parent.
 */
function compactResultDetails(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const {
    messages: _messages,
    finalOutput: _finalOutput,
    structuredOutput: _structuredOutput,
    acceptance,
    ...result
  } = value;
  if (isRecord(acceptance)) {
    const {
      childReport: _childReport,
      verifyRuns,
      ...compactAcceptance
    } = acceptance;
    result.acceptance = {
      ...compactAcceptance,
      ...(Array.isArray(verifyRuns)
        ? {
            verifyRuns: verifyRuns.map((run) => {
              if (!isRecord(run)) return run;
              const { stdout: _stdout, stderr: _stderr, ...compactRun } = run;
              return compactRun;
            }),
          }
        : {}),
    };
  }
  return result;
}

function compactChainOutput(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const { text: _text, structured: _structured, ...output } = value;
  return output;
}

/** Keep run state and artifact references, but not duplicate complete reports. */
export function compactSubagentDetails(details: unknown): unknown {
  if (!isRecord(details)) return details;
  const compact: UnknownRecord = { ...details };
  if (Array.isArray(details.results)) {
    compact.results = details.results.map(compactResultDetails);
  }
  if (isRecord(details.outputs)) {
    compact.outputs = Object.fromEntries(
      Object.entries(details.outputs).map(([name, value]) => [
        name,
        compactChainOutput(value),
      ]),
    );
  }
  return compact;
}

/**
 * Bounds the exact result returned by the active `subagent` tool before Pi
 * persists it as a parent toolResult message. Images stay in place; all text
 * blocks share one report budget so split blocks cannot bypass the backstop.
 */
export function limitSubagentToolResult(
  event: Pick<
    ToolResultEvent,
    "toolName" | "content" | "details" | "isError" | "usage"
  >,
) {
  if (event.toolName !== "subagent") return undefined;

  const report = event.content
    .filter(
      (block): block is { type: "text"; text: string } => block.type === "text",
    )
    .map((block) => block.text)
    .join("\n\n");
  const limited = limitSubagentOutput(report);
  let insertedText = false;
  const content: typeof event.content = [];
  for (const block of event.content) {
    if (block.type !== "text") {
      content.push(block);
      continue;
    }
    if (insertedText) continue;
    insertedText = true;
    content.push({ type: "text", text: limited.text });
  }
  if (!insertedText && limited.text) {
    content.unshift({ type: "text" as const, text: limited.text });
  }

  const compactDetails = compactSubagentDetails(event.details);
  const details = isRecord(compactDetails)
    ? {
        ...compactDetails,
        ...(limited.truncation ? { truncation: limited.truncation } : {}),
      }
    : compactDetails;
  return {
    content,
    details,
    isError: event.isError,
    usage: event.usage,
  };
}
