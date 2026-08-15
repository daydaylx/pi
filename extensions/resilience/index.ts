/**
 * Resilience: compact failure telemetry plus safe session recovery markers.
 *
 * Pi's JSONL session is the only source of truth. This extension appends small
 * custom entries to that session; it does not create a second log, retry loop,
 * workflow state, or task database.
 */
import type {
  AgentEndEvent,
  ExtensionAPI,
  ExtensionContext,
  MessageUpdateEvent,
} from "@earendil-works/pi-coding-agent";
import { collectWorkspaceSnapshot } from "../../shared/workspace-snapshot.mjs";
import { requestWorkflowCapabilities } from "../shared/workflow-capabilities.ts";
import type {
  CompactionBoundaryMarker,
  ErrorClass,
  FailureDiagnostic,
  OpenTurn,
  RecoveryRequiredMarker,
  TurnPhase,
  TurnSettledMarker,
  TurnStartMarker,
} from "./types.ts";

const SCHEMA_VERSION = 1 as const;

function contextPercent(ctx: ExtensionContext): number | null {
  return ctx.getContextUsage()?.percent ?? null;
}

function workspaceFingerprint(cwd: string): string {
  try {
    return collectWorkspaceSnapshot(cwd).fingerprint;
  } catch {
    // A recovery decision must fail closed when Git/snapshot collection is not
    // available: callers treat the unavailable value as changed/unsafe.
    return "unavailable";
  }
}

function workspaceChanged(startFingerprint: string, cwd: string): boolean {
  return (
    startFingerprint === "unavailable" ||
    workspaceFingerprint(cwd) !== startFingerprint
  );
}

function classifyFailure(errorMessage: string | undefined): {
  errorClass: ErrorClass;
  errorCode?: string;
} {
  const message = errorMessage ?? "";
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
    return message.stopReason === "error" || message.stopReason === "aborted"
      ? message.errorMessage
      : undefined;
  }
  return undefined;
}

function isMutatingTool(toolName: string): boolean {
  return toolName === "edit" || toolName === "write" || toolName === "bash";
}

function customData<T>(entry: unknown, customType: string): T | undefined {
  if (!entry || typeof entry !== "object") return undefined;
  const candidate = entry as {
    type?: unknown;
    customType?: unknown;
    data?: unknown;
  };
  return candidate.type === "custom" && candidate.customType === customType
    ? (candidate.data as T)
    : undefined;
}

function latestRecoveryState(entries: readonly unknown[]): {
  openTurn?: TurnStartMarker;
  finalFailure?: TurnSettledMarker;
  requiredByTurn: Map<string, RecoveryRequiredMarker>;
} {
  let openTurn: TurnStartMarker | undefined;
  let finalFailure: TurnSettledMarker | undefined;
  const requiredByTurn = new Map<string, RecoveryRequiredMarker>();
  for (const entry of entries) {
    const start = customData<TurnStartMarker>(entry, "resilience.turn-start");
    if (start) {
      openTurn = start;
      finalFailure = undefined;
      continue;
    }
    const settled = customData<TurnSettledMarker>(
      entry,
      "resilience.turn-settled",
    );
    if (settled && openTurn?.timestamp === settled.turnStartedAt) {
      openTurn = undefined;
      if (settled.outcome === "failed") finalFailure = settled;
      continue;
    }
    const required = customData<RecoveryRequiredMarker>(
      entry,
      "resilience.recovery-required",
    );
    if (required) requiredByTurn.set(required.turnStartedAt, required);
  }
  return { openTurn, finalFailure, requiredByTurn };
}

function recoveryInstruction(
  workspaceWasChanged: boolean,
  toolMayHaveMutatedWorkspace: boolean,
): string {
  const inspectionRequired = workspaceWasChanged || toolMayHaveMutatedWorkspace;
  return inspectionRequired
    ? "Die vorherige Ausführung wurde unterbrochen oder endete mit einem Fehler. Prüfe zuerst git status --short, den relevanten Diff/Workspace-Snapshot und die letzten validen Tool-Ergebnisse. Behandle vorhandene Änderungen als möglicherweise bereits ausgeführt. Wiederhole keine mutierende Aktion, bevor geklärt ist, ob sie bereits lief. Setze danach den Nutzerauftrag fort."
    : "Die vorherige Ausführung wurde unterbrochen oder endete mit einem Fehler, ohne erkennbare Workspace-Mutation. Setze den Nutzerauftrag vom letzten validen Sessionpunkt aus fort; replaye keinen partiellen Tool-Call blind.";
}

export default function resilienceExtension(pi: ExtensionAPI): void {
  let openTurn: OpenTurn | undefined;
  let sessionCwd = "";
  let pendingRecovery:
    | { workspaceWasChanged: boolean; toolMayHaveMutatedWorkspace: boolean }
    | undefined;

  function appendFailure(
    ctx: ExtensionContext,
    errorMessage: string | undefined,
  ): void {
    if (!openTurn) return;
    const classification = classifyFailure(errorMessage);
    const diagnostic: FailureDiagnostic = {
      schemaVersion: SCHEMA_VERSION,
      timestamp: new Date().toISOString(),
      provider: openTurn.marker.provider,
      model: openTurn.marker.model,
      contextPercent: contextPercent(ctx),
      errorClass: classification.errorClass,
      ...(classification.errorCode
        ? { errorCode: classification.errorCode }
        : {}),
      phase: openTurn.phase,
      workspaceChangedSinceTurnStart: workspaceChanged(
        openTurn.marker.workspaceFingerprint,
        sessionCwd,
      ),
      toolMayHaveMutatedWorkspace: openTurn.toolMayHaveMutatedWorkspace,
      activeSubagents: openTurn.activeSubagents,
      settled: false,
    };
    openTurn.observedFailureCount += 1;
    openTurn.currentAttemptFailed = true;
    pi.appendEntry("resilience.failure", diagnostic);
  }

  function armRecovery(
    marker: TurnStartMarker,
    toolMayHaveMutatedWorkspace: boolean,
  ): NonNullable<typeof pendingRecovery> {
    const recovery = {
      workspaceWasChanged: workspaceChanged(
        marker.workspaceFingerprint,
        sessionCwd,
      ),
      toolMayHaveMutatedWorkspace,
    };
    pendingRecovery = recovery;
    return recovery;
  }

  function appendRecoveryRequired(
    reason: RecoveryRequiredMarker["reason"],
    marker: TurnStartMarker,
    toolMayHaveMutatedWorkspace: boolean,
  ): void {
    const recovery = armRecovery(marker, toolMayHaveMutatedWorkspace);
    const record: RecoveryRequiredMarker = {
      schemaVersion: SCHEMA_VERSION,
      timestamp: new Date().toISOString(),
      turnStartedAt: marker.timestamp,
      reason,
      workspaceChangedSinceTurnStart: recovery.workspaceWasChanged,
      toolMayHaveMutatedWorkspace,
    };
    pi.appendEntry("resilience.recovery-required", record);
  }

  pi.on("session_start", (_event, ctx) => {
    sessionCwd = ctx.cwd;
    openTurn = undefined;
    pendingRecovery = undefined;

    const entries = ctx.sessionManager.getBranch();
    const prior = latestRecoveryState(entries);
    if (prior.openTurn) {
      const existing = prior.requiredByTurn.get(prior.openTurn.timestamp);
      if (existing)
        armRecovery(prior.openTurn, existing.toolMayHaveMutatedWorkspace);
      else appendRecoveryRequired("interrupted", prior.openTurn, false);
      return;
    }
    if (prior.finalFailure) {
      const start = entries
        .map((entry) =>
          customData<TurnStartMarker>(entry, "resilience.turn-start"),
        )
        .find(
          (marker) => marker?.timestamp === prior.finalFailure?.turnStartedAt,
        );
      if (!start) return;
      const existing = prior.requiredByTurn.get(
        prior.finalFailure.turnStartedAt,
      );
      if (existing) armRecovery(start, existing.toolMayHaveMutatedWorkspace);
      else appendRecoveryRequired("final_failure", start, false);
    }
  });

  pi.on("before_agent_start", (_event, ctx) => {
    sessionCwd = ctx.cwd;
    const recovery = pendingRecovery;
    pendingRecovery = undefined;
    const marker: TurnStartMarker = {
      schemaVersion: SCHEMA_VERSION,
      timestamp: new Date().toISOString(),
      workspaceFingerprint: workspaceFingerprint(ctx.cwd),
      workflowMode: requestWorkflowCapabilities(pi.events).mode,
      provider: ctx.model?.provider ?? "unknown",
      model: ctx.model?.id ?? "unknown",
      contextPercent: contextPercent(ctx),
    };
    openTurn = {
      marker,
      phase: "before_first_token",
      activeSubagents: 0,
      toolMayHaveMutatedWorkspace: false,
      observedFailureCount: 0,
      currentAttemptFailed: false,
    };
    pi.appendEntry("resilience.turn-start", marker);
    if (!recovery) return;
    return {
      message: {
        customType: "pi-resilience-recovery",
        content: recoveryInstruction(
          recovery.workspaceWasChanged,
          recovery.toolMayHaveMutatedWorkspace,
        ),
        display: false,
      },
    };
  });

  pi.on("agent_start", () => {
    if (!openTurn) return;
    // A second agent_start before settled is Pi's native retry. This extension
    // observes it but never performs or configures retries itself.
    openTurn.currentAttemptFailed = false;
  });

  pi.on("after_provider_response", (event, ctx) => {
    if (event.status >= 400) appendFailure(ctx, String(event.status));
  });

  pi.on("message_update", (event, ctx) => {
    if (!openTurn) return;
    const phase = phaseFromMessage(event);
    if (phase) openTurn.phase = phase;
    if (event.assistantMessageEvent.type === "error") {
      appendFailure(ctx, event.assistantMessageEvent.error.errorMessage);
    }
  });

  pi.on("tool_execution_start", (event) => {
    if (!openTurn) return;
    openTurn.phase = "tool_running";
    if (isMutatingTool(event.toolName))
      openTurn.toolMayHaveMutatedWorkspace = true;
  });

  pi.on("tool_execution_end", () => {
    if (openTurn) openTurn.phase = "post_tool";
  });

  pi.on("session_before_compact", (event, ctx) => {
    if (openTurn) openTurn.phase = "compaction";
    const marker: CompactionBoundaryMarker = {
      schemaVersion: SCHEMA_VERSION,
      timestamp: new Date().toISOString(),
      boundary: "started",
      reason: event.reason,
      willRetry: event.willRetry,
      workspaceFingerprint: workspaceFingerprint(ctx.cwd),
      workflowMode: requestWorkflowCapabilities(pi.events).mode,
      contextPercent: contextPercent(ctx),
    };
    pi.appendEntry("resilience.compaction-boundary", marker);
  });

  // The runtime patch "agent-session-compaction-failure-*" (see
  // scripts/apply-runtime-patches.mjs) forwards this event from the core
  // compaction paths. It is not part of the shipped ExtensionAPI .d.ts, so
  // only this registration is cast; every other hook stays fully typed.
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
      ) => void,
    ) => void
  )("session_compact_failed", (event, ctx) => {
    if (openTurn) openTurn.phase = "compaction";
    const marker: CompactionBoundaryMarker = {
      schemaVersion: SCHEMA_VERSION,
      timestamp: new Date().toISOString(),
      boundary: "failed",
      reason: event.reason,
      willRetry: event.willRetry,
      workspaceFingerprint: workspaceFingerprint(ctx.cwd),
      workflowMode: requestWorkflowCapabilities(pi.events).mode,
      contextPercent: contextPercent(ctx),
      errorMessage: event.errorMessage,
    };
    pi.appendEntry("resilience.compaction-boundary", marker);
    appendFailure(ctx, event.errorMessage);
  });

  pi.on("session_compact", (event, ctx) => {
    if (openTurn) openTurn.phase = "post_tool";
    const marker: CompactionBoundaryMarker = {
      schemaVersion: SCHEMA_VERSION,
      timestamp: new Date().toISOString(),
      boundary: "completed",
      reason: event.reason,
      willRetry: event.willRetry,
      workspaceFingerprint: workspaceFingerprint(ctx.cwd),
      workflowMode: requestWorkflowCapabilities(pi.events).mode,
      contextPercent: contextPercent(ctx),
    };
    pi.appendEntry("resilience.compaction-boundary", marker);
  });

  pi.on("agent_end", (event, ctx) => {
    const error = lastAssistantError(event);
    if (error && !openTurn?.currentAttemptFailed) appendFailure(ctx, error);
  });

  pi.on("agent_settled", (_event, ctx) => {
    if (!openTurn) return;
    const settled: TurnSettledMarker = {
      schemaVersion: SCHEMA_VERSION,
      timestamp: new Date().toISOString(),
      turnStartedAt: openTurn.marker.timestamp,
      workspaceFingerprint: workspaceFingerprint(ctx.cwd),
      outcome: openTurn.currentAttemptFailed ? "failed" : "completed",
      observedFailureCount: openTurn.observedFailureCount,
    };
    pi.appendEntry("resilience.turn-settled", settled);
    if (settled.outcome === "failed") {
      appendRecoveryRequired(
        "final_failure",
        openTurn.marker,
        openTurn.toolMayHaveMutatedWorkspace,
      );
    }
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
