/**
 * Resilience: compact failure telemetry plus a stateless interruption notice.
 *
 * Pi's JSONL session is the only source of truth. This extension appends small
 * custom entries to that session; it does not create a second log, retry loop,
 * write gate, workflow state, or task database. When the previous run ended
 * before the model could confirm its mutating tool calls, the next run gets
 * one hidden message with the facts (ADR 041).
 */
import type {
  AgentEndEvent,
  ExtensionAPI,
  ExtensionContext,
  MessageUpdateEvent,
} from "@earendil-works/pi-coding-agent";
import { resolve } from "node:path";
import { gitEnv } from "../../shared/workspace-snapshot.mjs";
import { canonicalWorkspaceRoot } from "../shared/workspace-scope.ts";
import { trackedExec } from "../shared/tracked-exec.ts";
import { limitTextOutput } from "../shared/output-limits.ts";
import {
  findInterruptedRun,
  formatInterruptionNotice,
} from "./interruption.ts";
import type {
  CompactionBoundaryMarker,
  ErrorClass,
  FailureDiagnostic,
  InterruptionNoticeMarker,
  OpenTurn,
  TurnPhase,
  TurnSettledMarker,
  TurnStartMarker,
} from "./types.ts";
import { ERROR_MESSAGE_MAX } from "./types.ts";

const SCHEMA_VERSION = 2 as const;

function contextPercent(ctx: ExtensionContext): number | null {
  return ctx.getContextUsage()?.percent ?? null;
}

function primaryWorkspaceRoot(cwd: string): string {
  return canonicalWorkspaceRoot(cwd) ?? resolve(cwd);
}

function classifyFailure(
  errorMessage: string | undefined,
  phase: TurnPhase,
): {
  errorClass: ErrorClass;
  errorCode?: string;
} {
  const message = errorMessage ?? "";
  if (!message.trim() && phase.startsWith("streaming")) {
    // Ein Streaming-Abbruch ohne Fehlertext darf nicht als unbekannter Fehler
    // ohne Kontext erscheinen — die Phase selbst ist der Beleg.
    return { errorClass: "stream", errorCode: "STREAM_PHASE" };
  }
  const code = message.match(
    /\b(ECONNRESET|ECONNREFUSED|EPIPE|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ESOCKETTIMEDOUT)\b/,
  )?.[1];
  if (code) {
    return {
      errorClass:
        code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT"
          ? "timeout"
          : "network",
      errorCode: code,
    };
  }
  if (
    /\b(AccessDenied|Unpurchased|eligible for using the model|access to model denied)\b/i.test(
      message,
    )
  ) {
    return { errorClass: "auth", errorCode: "MODEL_ACCESS_DENIED" };
  }
  const status = message.match(/\b([45]\d\d)\b/)?.[1];
  if (status) return { errorClass: "http", errorCode: `HTTP_${status}` };
  if (/\b(auth|unauthori[sz]ed|forbidden|api key)\b/i.test(message)) {
    return { errorClass: "auth", errorCode: "AUTH" };
  }
  if (/\b(timeout|timed out)\b/i.test(message)) {
    return { errorClass: "timeout", errorCode: "TIMEOUT" };
  }
  if (/\b(stream|sse|websocket)\b/i.test(message)) {
    return { errorClass: "stream", errorCode: "STREAM" };
  }
  return { errorClass: "unknown" };
}

function truncateErrorMessage(message: string | undefined): string | undefined {
  if (!message) return undefined;
  return message.length > ERROR_MESSAGE_MAX
    ? `${message.slice(0, ERROR_MESSAGE_MAX)}…`
    : message;
}

const GIT_TEXT_TIMEOUT_MS = 15_000;

/**
 * `git status --short` output for the interruption notice.
 * Same ENOBUFS risk class as F-01/F-02's root cause — execFileSync's default
 * 1 MiB pipe limit — reachable here via file *count* (many thousands of
 * changed paths) rather than diff size. trackedExec's spawn-based accumulator
 * drains both streams while retaining only bounded display text.
 */
async function gitText(
  cwd: string,
  args: string[],
  signal?: AbortSignal,
): Promise<string> {
  const result = await trackedExec("git", args, {
    cwd,
    timeout: GIT_TEXT_TIMEOUT_MS,
    env: gitEnv(),
    signal,
    maxOutputBytes: 256 * 1024,
  });
  if (result.code !== 0 || result.killed) {
    throw new Error(
      result.stderr.trim() ||
        `git ${args.join(" ")} schlug fehl (exit=${result.code === null ? "unbekannt" : result.code}${result.killed ? ", killed" : ""}).`,
    );
  }
  return (
    limitTextOutput(result.stdout).text +
    (result.stdoutTruncated ? "\n[Git-Ausgabe nach 256 KiB gekürzt.]" : "")
  );
}

function phaseFromMessage(event: MessageUpdateEvent): TurnPhase | undefined {
  if (event.assistantMessageEvent.type.startsWith("text_")) {
    return "streaming_text";
  }
  if (event.assistantMessageEvent.type.startsWith("toolcall_")) {
    return "streaming_tool_call";
  }
  return undefined;
}

function lastAssistantError(event: AgentEndEvent): string | undefined {
  for (let index = event.messages.length - 1; index >= 0; index -= 1) {
    const message = event.messages[index];
    if (message.role !== "assistant") continue;
    return message.stopReason === "error" ? message.errorMessage : undefined;
  }
  return undefined;
}

function agentEndWasAborted(event: AgentEndEvent): boolean {
  for (let index = event.messages.length - 1; index >= 0; index -= 1) {
    const message = event.messages[index];
    if (message.role !== "assistant") continue;
    return message.stopReason === "aborted";
  }
  return false;
}

/** Workspace-Zustand für den Hinweis: nur lesend, ohne Einfluss auf Berechtigungen. */
async function workspaceReport(
  root: string,
  signal?: AbortSignal,
): Promise<string> {
  try {
    const status = await gitText(root, ["status", "--short"], signal);
    return [
      `Workspace ${root} (git status --short):`,
      status.trim() || "(keine Änderungen)",
    ].join("\n");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `Workspace ${root}: Zustand nicht prüfbar (${message.slice(0, 160)}). Ohne Git-Repository lies betroffene Dateien erneut, bevor du sie änderst.`;
  }
}

export default function resilienceExtension(pi: ExtensionAPI): void {
  let openTurn: OpenTurn | undefined;
  // Bumped by session_start/session_shutdown so an await that outlives its
  // session cannot write into the next one.
  let sessionGeneration = 0;
  let turnGeneration = 0;

  async function appendFailure(
    ctx: ExtensionContext,
    errorMessage: string | undefined,
  ): Promise<void> {
    const turn = openTurn;
    if (!turn) return;
    turn.observedFailureCount += 1;
    turn.currentAttemptFailed = true;
    const classification = classifyFailure(errorMessage, turn.phase);
    const diagnostic: FailureDiagnostic = {
      schemaVersion: SCHEMA_VERSION,
      timestamp: new Date().toISOString(),
      provider: turn.marker.provider,
      model: turn.marker.model,
      contextPercent: contextPercent(ctx),
      errorClass: classification.errorClass,
      ...(classification.errorCode
        ? { errorCode: classification.errorCode }
        : {}),
      ...(truncateErrorMessage(errorMessage)
        ? { errorMessage: truncateErrorMessage(errorMessage) }
        : {}),
      phase: turn.phase,
      activeSubagents: turn.activeSubagents,
      settled: false,
    };
    pi.appendEntry("resilience.failure", diagnostic);
  }

  pi.on("session_start", () => {
    sessionGeneration += 1;
    turnGeneration += 1;
    openTurn = undefined;
  });

  pi.on("before_agent_start", async (_event, ctx) => {
    const generation = sessionGeneration;
    const turnId = ++turnGeneration;
    const marker: TurnStartMarker = {
      schemaVersion: SCHEMA_VERSION,
      timestamp: new Date().toISOString(),
      provider: ctx.model?.provider ?? "unknown",
      model: ctx.model?.id ?? "unknown",
      contextPercent: contextPercent(ctx),
    };
    openTurn = {
      marker,
      phase: "before_first_token",
      activeSubagents: 0,
      observedFailureCount: 0,
      currentAttemptFailed: false,
      currentAttemptAborted: false,
    };
    pi.appendEntry("resilience.turn-start", marker);

    const run = findInterruptedRun(ctx.sessionManager.getBranch(), ctx.cwd);
    if (!run) return;
    const root = primaryWorkspaceRoot(ctx.cwd);
    const report = await workspaceReport(root, ctx.signal);
    if (generation !== sessionGeneration || turnId !== turnGeneration) return;
    const notice: InterruptionNoticeMarker = {
      schemaVersion: SCHEMA_VERSION,
      timestamp: new Date().toISOString(),
      reason: run.reason,
      entryId: run.entryId,
      mutatingCalls: run.calls.length,
      unconfirmedCalls: run.calls.filter((call) => call.outcome === "none")
        .length,
    };
    pi.appendEntry("resilience.interruption-notice", notice);
    return {
      message: {
        customType: "pi-resilience-recovery",
        content: formatInterruptionNotice(run, report),
        display: false,
      },
    };
  });

  pi.on("agent_start", () => {
    if (!openTurn) return;
    // A second agent_start before settled is Pi's native retry. This extension
    // observes it but never performs or configures retries itself.
    openTurn.currentAttemptFailed = false;
    openTurn.currentAttemptAborted = false;
  });

  pi.on("after_provider_response", async (event, ctx) => {
    if (event.status >= 400) await appendFailure(ctx, String(event.status));
  });

  pi.on("message_update", async (event, ctx) => {
    if (!openTurn) return;
    const phase = phaseFromMessage(event);
    if (phase) openTurn.phase = phase;
    if (event.assistantMessageEvent.type === "error") {
      await appendFailure(ctx, event.assistantMessageEvent.error.errorMessage);
    }
  });

  pi.on("tool_execution_start", () => {
    if (!openTurn) return;
    openTurn.phase = "tool_running";
  });

  pi.on("tool_execution_end", () => {
    if (!openTurn) return;
    openTurn.phase = "post_tool";
  });

  function compactionMarker(
    boundary: CompactionBoundaryMarker["boundary"],
    event: {
      reason: CompactionBoundaryMarker["reason"];
      willRetry: boolean;
    },
    ctx: ExtensionContext,
    errorMessage?: string,
  ): CompactionBoundaryMarker {
    return {
      schemaVersion: SCHEMA_VERSION,
      timestamp: new Date().toISOString(),
      boundary,
      reason: event.reason,
      willRetry: event.willRetry,
      contextPercent: contextPercent(ctx),
      ...(errorMessage ? { errorMessage } : {}),
    };
  }

  pi.on("session_before_compact", (event, ctx) => {
    if (openTurn) openTurn.phase = "compaction";
    pi.appendEntry(
      "resilience.compaction-boundary",
      compactionMarker("started", event, ctx),
    );
  });

  // The installed Pi runtime emits this event natively from its core compaction
  // paths (`_emitSessionCompactFailed`). It is not part of the shipped
  // ExtensionAPI .d.ts, so only this registration is cast; every other hook
  // stays fully typed.
  type SessionCompactFailedEvent = {
    type: "session_compact_failed";
    reason: "manual" | "threshold" | "overflow";
    errorMessage: string;
    willRetry: boolean;
  };
  (
    pi.on as unknown as (
      event: "session_compact_failed",
      handler: (
        event: SessionCompactFailedEvent,
        ctx: ExtensionContext,
      ) => void | Promise<void>,
    ) => void
  )("session_compact_failed", async (event, ctx) => {
    if (openTurn) openTurn.phase = "compaction";
    pi.appendEntry(
      "resilience.compaction-boundary",
      compactionMarker("failed", event, ctx, event.errorMessage),
    );
    await appendFailure(ctx, event.errorMessage);
  });

  pi.on("session_compact", (event, ctx) => {
    if (openTurn) openTurn.phase = "post_tool";
    pi.appendEntry(
      "resilience.compaction-boundary",
      compactionMarker("completed", event, ctx),
    );
  });

  pi.on("agent_end", async (event, ctx) => {
    if (agentEndWasAborted(event) && openTurn) {
      openTurn.currentAttemptAborted = true;
      return;
    }
    const error = lastAssistantError(event);
    if (error && !openTurn?.currentAttemptFailed)
      await appendFailure(ctx, error);
  });

  pi.on("agent_settled", () => {
    const turn = openTurn;
    if (!turn) return;
    const failed = turn.currentAttemptFailed;
    const outcome: TurnSettledMarker["outcome"] = failed
      ? "failed"
      : turn.currentAttemptAborted
        ? "aborted"
        : turn.observedFailureCount > 0
          ? "completed_after_failure"
          : "completed";
    const settled: TurnSettledMarker = {
      schemaVersion: SCHEMA_VERSION,
      timestamp: new Date().toISOString(),
      turnStartedAt: turn.marker.timestamp,
      outcome,
      observedFailureCount: turn.observedFailureCount,
    };
    pi.appendEntry("resilience.turn-settled", settled);
    openTurn = undefined;
  });

  pi.on("session_shutdown", () => {
    sessionGeneration += 1;
    turnGeneration += 1;
    openTurn = undefined;
  });

  pi.events.on("subagent:async-started", () => {
    if (openTurn) openTurn.activeSubagents += 1;
  });

  pi.events.on("subagent:async-complete", () => {
    if (openTurn)
      openTurn.activeSubagents = Math.max(0, openTurn.activeSubagents - 1);
  });
}
