import type { ToolResultEvent } from "@earendil-works/pi-coding-agent";
import { limitSubagentOutput } from "../shared/output-limits.ts";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export type VerifierRunStatus = "completed" | "incomplete";

export type VerifierVerdict =
  | "PASS"
  | "PASS_WITH_WARNINGS"
  | "FAIL"
  | "UNVERIFIABLE";

export interface VerifierRunRecord {
  timestamp: string;
  agent: "verifier";
  status: VerifierRunStatus;
  /** timeout | turn-budget | interrupted | detached | provider-error | exit-<n> */
  reason?: string;
  /** Nur bei erfolgreichen Läufen, falls das Urteil erkennbar ist. */
  verdict?: VerifierVerdict;
  attemptedModels?: string[];
}

/**
 * Muster für Provider-/Netzwerk-/Auth-Fehler. Sie entscheiden nur über die
 * Benennung eines abnormalen Laufendes — niemals über Fallback oder
 * Wiederholung.
 */
const PROVIDER_ERROR_PATTERN =
  /rate.?limit|too many requests|\b429\b|quota|auth(?:entication)?|unauthori[sz]ed|forbidden|api key|provider|service unavailable|overloaded|connection|network|socket|timed? ?out|timeout|\b50[0234]\b|fetch failed|empty response/i;

export function parseVerifierVerdict(
  text: string,
): VerifierVerdict | undefined {
  const match = text.match(/^\s*(PASS_WITH_WARNINGS|PASS|FAIL|UNVERIFIABLE)\b/m);
  return match?.[1] as VerifierVerdict | undefined;
}

/**
 * Leitet aus dem Tool-Result eines Verifier-Laufs den strukturierten
 * Session-Eintrag ab. Abgebrochene, zeitüberschrittene oder
 * providerfehlerhafte Läufe sind `incomplete` und dürfen nie als
 * unabhängige Verifikation zählen; ein fachliches FAIL bei erfolgreichem
 * Lauf bleibt `completed` mit `verdict: "FAIL"`.
 */
export function extractVerifierRunRecord(
  details: unknown,
): VerifierRunRecord | undefined {
  if (!isRecord(details)) return undefined;
  const results = Array.isArray(details.results) ? details.results : [];
  const result = results[0];
  if (!isRecord(result) || result.agent !== "verifier") return undefined;

  const record: VerifierRunRecord = {
    timestamp: new Date().toISOString(),
    agent: "verifier",
    status: "completed",
  };
  if (Array.isArray(result.attemptedModels)) {
    const models = result.attemptedModels.filter(
      (model): model is string => typeof model === "string",
    );
    if (models.length > 0) record.attemptedModels = models;
  }

  const incompleteReason = result.timedOut
    ? "timeout"
    : result.turnBudgetExceeded
      ? "turn-budget"
      : result.interrupted
        ? "interrupted"
        : result.detached
          ? "detached"
          : undefined;
  if (incompleteReason) {
    record.status = "incomplete";
    record.reason = incompleteReason;
    return record;
  }
  if (typeof result.exitCode === "number" && result.exitCode !== 0) {
    record.status = "incomplete";
    const error = typeof result.error === "string" ? result.error : "";
    record.reason = PROVIDER_ERROR_PATTERN.test(error)
      ? "provider-error"
      : `exit-${result.exitCode}`;
    return record;
  }
  const output = typeof result.finalOutput === "string" ? result.finalOutput : "";
  const verdict = parseVerifierVerdict(output);
  if (verdict) record.verdict = verdict;
  return record;
}

export function verifierIncompleteBanner(reason: string | undefined): string {
  const cause =
    reason === "timeout"
      ? "wegen Zeitüberschreitung abgebrochen"
      : reason === "turn-budget"
        ? "wegen Überschreitung des Turn-Budgets abgebrochen (turnBudget ist für Verifier verboten)"
        : reason === "interrupted"
          ? "unterbrochen"
          : reason === "detached"
            ? "vor Abschluss abgelöst"
            : reason === "provider-error"
              ? "durch einen Provider-/Netzwerkfehler beendet"
              : `mit Fehler beendet (${reason ?? "unbekannt"})`;
  return `⚠ INCOMPLETE — Dieser Verifier-Lauf wurde ${cause} und zählt nicht als unabhängige Verifikation. Er ersetzt keine bestandene Prüfung und darf nicht als Verifikationsnachweis übernommen werden.\n\n`;
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
