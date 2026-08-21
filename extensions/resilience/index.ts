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
import { execFileSync } from "node:child_process";
import { Type } from "typebox";
import { collectWorkspaceSnapshot } from "../../shared/workspace-snapshot.mjs";
import { requestWorkflowCapabilities } from "../shared/workflow-capabilities.ts";
import {
  RECOVERY_CAPABILITY_EVENTS,
  type RecoveryStatusRequest,
  type RecoveryStatusSnapshot,
} from "../shared/recovery-capabilities.ts";
import {
  UI_STATUS_KEYS,
  setTuiStatus,
} from "../shared/workflow-status.ts";
import { limitTextOutput } from "../shared/output-limits.ts";
import {
  customData,
  gateRequiresInspection,
  latestRecoveryGate,
  type RecoveryGateState,
} from "./recovery-state.ts";
import type {
  CompactionBoundaryMarker,
  ErrorClass,
  FailureDiagnostic,
  OpenTurn,
  RecoveryCheckedMarker,
  RecoveryRequiredMarker,
  TurnPhase,
  TurnSettledMarker,
  TurnStartMarker,
} from "./types.ts";
import { ERROR_MESSAGE_MAX } from "./types.ts";

const SCHEMA_VERSION = 2 as const;

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

function gitText(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
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
  let activeContext: ExtensionContext | undefined;
  let gate: RecoveryGateState | undefined;
  let pendingRecovery:
    | { workspaceWasChanged: boolean; toolMayHaveMutatedWorkspace: boolean }
    | undefined;

  /**
   * Der Recovery-Status für Guard und UI. Ein geprüftes Gate bleibt nur
   * offen, solange der Workspace-Fingerprint dem Prüfzeitpunkt entspricht.
   */
  function recoverySnapshot(): RecoveryStatusSnapshot {
    if (!gate || !gateRequiresInspection(gate.required)) {
      return { armed: false };
    }
    if (!gate.checked) {
      return {
        armed: true,
        turnStartedAt: gate.required.turnStartedAt,
        reason: gate.required.reason,
      };
    }
    if (workspaceChanged(gate.checked.workspaceFingerprint, sessionCwd)) {
      return {
        armed: true,
        turnStartedAt: gate.required.turnStartedAt,
        reason: "workspace-changed",
      };
    }
    return { armed: false };
  }

  function updateRecoveryStatus(): void {
    if (!activeContext) return;
    const snapshot = recoverySnapshot();
    setTuiStatus(
      activeContext,
      UI_STATUS_KEYS.recovery,
      snapshot.armed ? "⚠ Recovery-Check offen" : undefined,
    );
  }

  function appendFailure(
    ctx: ExtensionContext,
    errorMessage: string | undefined,
  ): void {
    if (!openTurn) return;
    const classification = classifyFailure(errorMessage, openTurn.phase);
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
      ...(truncateErrorMessage(errorMessage)
        ? { errorMessage: truncateErrorMessage(errorMessage) }
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
  ): RecoveryRequiredMarker {
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
    return record;
  }

  pi.on("session_start", (_event, ctx) => {
    sessionCwd = ctx.cwd;
    activeContext = ctx;
    openTurn = undefined;
    pendingRecovery = undefined;
    const entries = ctx.sessionManager.getBranch();
    // Neustart-Wahrheit zuerst aus den Einträgen: Ein bereits geprüftes Gate
    // behält seinen checked-Zustand über die Sitzung hinaus.
    gate = latestRecoveryGate(entries);
    const prior = latestRecoveryState(entries);
    if (prior.openTurn) {
      const existing = prior.requiredByTurn.get(prior.openTurn.timestamp);
      if (existing) {
        armRecovery(prior.openTurn, existing.toolMayHaveMutatedWorkspace);
      } else {
        gate = {
          required: appendRecoveryRequired("interrupted", prior.openTurn, false),
        };
      }
    } else if (prior.finalFailure) {
      const start = entries
        .map((entry) =>
          customData<TurnStartMarker>(entry, "resilience.turn-start"),
        )
        .find(
          (marker) => marker?.timestamp === prior.finalFailure?.turnStartedAt,
        );
      if (start) {
        const existing = prior.requiredByTurn.get(
          prior.finalFailure.turnStartedAt,
        );
        if (existing) {
          armRecovery(start, existing.toolMayHaveMutatedWorkspace);
        } else {
          gate = {
            required: appendRecoveryRequired("final_failure", start, false),
          };
        }
      }
    }
    updateRecoveryStatus();
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
    const failed = openTurn.currentAttemptFailed;
    const outcome: TurnSettledMarker["outcome"] = failed
      ? "failed"
      : openTurn.observedFailureCount > 0
        ? "completed_after_failure"
        : "completed";
    const settled: TurnSettledMarker = {
      schemaVersion: SCHEMA_VERSION,
      timestamp: new Date().toISOString(),
      turnStartedAt: openTurn.marker.timestamp,
      workspaceFingerprint: workspaceFingerprint(ctx.cwd),
      outcome,
      observedFailureCount: openTurn.observedFailureCount,
      ...(failed ? { recoveryPending: true } : {}),
    };
    pi.appendEntry("resilience.turn-settled", settled);
    if (failed) {
      const required = appendRecoveryRequired(
        "final_failure",
        openTurn.marker,
        openTurn.toolMayHaveMutatedWorkspace,
      );
      // Das Gate sperrt nur bei möglicher Mutation; ein Fehlturn ohne jede
      // Workspace-Spur verlangt eine Fortsetzungs-Anweisung, keinen Check.
      gate = gateRequiresInspection(required) ? { required } : undefined;
      updateRecoveryStatus();
    }
    openTurn = undefined;
  });

  pi.on("session_shutdown", (_event, ctx) => {
    activeContext = undefined;
    gate = undefined;
    pendingRecovery = undefined;
    setTuiStatus(ctx, UI_STATUS_KEYS.recovery, undefined);
  });

  pi.events.on(RECOVERY_CAPABILITY_EVENTS.request, (value) => {
    const request = value as Partial<RecoveryStatusRequest>;
    request.respond?.(recoverySnapshot());
  });

  pi.registerTool({
    name: "recovery_check",
    label: "Recovery prüfen",
    description:
      "Read-only-Recovery-Check nach einem unterbrochenen oder fehlgeschlagenen Turn: erfasst Workspace-Snapshot, git status --short und eine begrenzte Diff-Zusammenfassung und hebt die Recovery-Schreibsperre auf, solange der Workspace-Fingerprint danach unverändert bleibt. Führt selbst keine Schreiboperationen aus und wiederholt nichts.",
    promptSnippet:
      "Inspect the workspace after an interrupted or failed turn and release the recovery write gate.",
    parameters: Type.Object({}),
    executionMode: "sequential",
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      let snapshot;
      try {
        snapshot = collectWorkspaceSnapshot(ctx.cwd);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        throw new Error(
          `Recovery-Check fehlgeschlagen: kein Workspace-Snapshot (${message}). Die Schreibsperre bleibt bestehen.`,
        );
      }
      let gitStatus: string;
      try {
        gitStatus = gitText(ctx.cwd, ["status", "--short"]);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        throw new Error(
          `Recovery-Check fehlgeschlagen: git status nicht lesbar (${message}). Die Schreibsperre bleibt bestehen.`,
        );
      }
      let diffStat = "";
      try {
        diffStat = gitText(ctx.cwd, ["diff", "--stat"]);
      } catch {
        diffStat = "(Diff-Zusammenfassung nicht verfügbar)";
      }

      const openRequired = gate?.required;
      if (openRequired) {
        const record: RecoveryCheckedMarker = {
          schemaVersion: SCHEMA_VERSION,
          timestamp: new Date().toISOString(),
          turnStartedAt: openRequired.turnStartedAt,
          workspaceFingerprint: snapshot.fingerprint,
        };
        pi.appendEntry("resilience.recovery-checked", record);
        gate = { required: openRequired, checked: record };
      }
      updateRecoveryStatus();

      const statusText = gitStatus.trim() || "(keine Änderungen)";
      const lines = [
        openRequired
          ? "Recovery-Check abgeschlossen: Die Schreibsperre ist aufgehoben, solange der Workspace-Fingerprint unverändert bleibt."
          : "Kein offenes Recovery-Gate gefunden; der Workspace wurde trotzdem geprüft.",
        `Workspace-Fingerprint: ${snapshot.fingerprint}`,
        "",
        "git status --short:",
        statusText,
      ];
      if (diffStat.trim()) {
        lines.push("", "git diff --stat:", diffStat.trim());
      }
      const limited = limitTextOutput(lines.join("\n"));
      return {
        content: [{ type: "text" as const, text: limited.text }],
        details: {
          turnStartedAt: openRequired?.turnStartedAt,
          changedFiles: snapshot.changedFiles,
          ...(limited.truncation ? { truncation: limited.truncation } : {}),
        },
      };
    },
  });

  pi.events.on("subagent:async-started", () => {
    if (openTurn) openTurn.activeSubagents += 1;
  });

  pi.events.on("subagent:async-complete", () => {
    if (openTurn)
      openTurn.activeSubagents = Math.max(0, openTurn.activeSubagents - 1);
  });
}
