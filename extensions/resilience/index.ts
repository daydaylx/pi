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
import { Type } from "typebox";
import {
  collectWorkspaceSnapshot,
  gitEnv,
} from "../../shared/workspace-snapshot.mjs";
import { trackedExec } from "../shared/tracked-exec.ts";
import { requestWorkflowCapabilities } from "../shared/workflow-capabilities.ts";
import {
  RECOVERY_CAPABILITY_EVENTS,
  type RecoveryStatusRequest,
  type RecoveryStatusSnapshot,
} from "../shared/recovery-capabilities.ts";
import { UI_STATUS_KEYS, setTuiStatus } from "../shared/workflow-status.ts";
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

async function workspaceFingerprint(cwd: string): Promise<string> {
  const result = await collectWorkspaceSnapshot(cwd);
  // A recovery decision must fail closed when Git/snapshot collection is not
  // available: callers treat the unavailable value as changed/unsafe.
  return result.ok ? result.snapshot.fingerprint : "unavailable";
}

async function workspaceChanged(
  startFingerprint: string,
  cwd: string,
): Promise<boolean> {
  return (
    startFingerprint === "unavailable" ||
    (await workspaceFingerprint(cwd)) !== startFingerprint
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

const GIT_TEXT_TIMEOUT_MS = 15_000;

/**
 * `git status --short`/`git diff --stat` output for recovery_check's report.
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
  // Bumped by session_start/session_shutdown. agent_settled now awaits a
  // real snapshot collection before writing gate/openTurn — captured once
  // per call so a session restart landing mid-await is detectable and the
  // stale write is dropped instead of clobbering the new session's state.
  let sessionGeneration = 0;
  let turnGeneration = 0;

  /**
   * Der Recovery-Status für Guard und UI. Ein geprüftes Gate bleibt nur
   * offen, solange der Workspace-Fingerprint dem Prüfzeitpunkt entspricht.
   */
  async function recoverySnapshot(): Promise<RecoveryStatusSnapshot> {
    // Captured once, up front: gate is shared module state, and this
    // function now awaits a real snapshot collection. It is called from the
    // permission guard's tool_call hot path with no try/catch around it —
    // reading `gate` again after the await (instead of this captured
    // reference) would throw if a concurrent agent_settled/session_shutdown
    // reassigns or clears it mid-await, taking the guard down with it.
    const currentGate = gate;
    const generation = sessionGeneration;
    const cwd = sessionCwd;
    if (!currentGate || !gateRequiresInspection(currentGate.required)) {
      return { armed: false };
    }
    if (!currentGate.checked) {
      return {
        armed: true,
        turnStartedAt: currentGate.required.turnStartedAt,
        reason: currentGate.required.reason,
      };
    }
    const changed = await workspaceChanged(
      currentGate.checked.workspaceFingerprint,
      cwd,
    );
    if (generation !== sessionGeneration || gate !== currentGate) {
      // An answer for an obsolete gate must never authorize a write.
      return { armed: true };
    }
    if (changed) {
      return {
        armed: true,
        turnStartedAt: currentGate.required.turnStartedAt,
        reason: "workspace-changed",
      };
    }
    return { armed: false };
  }

  async function updateRecoveryStatus(): Promise<void> {
    const ctx = activeContext;
    const generation = sessionGeneration;
    if (!ctx) return;
    const snapshot = await recoverySnapshot();
    if (generation !== sessionGeneration || ctx !== activeContext) return;
    setTuiStatus(
      ctx,
      UI_STATUS_KEYS.recovery,
      snapshot.armed ? "⚠ Recovery-Check offen" : undefined,
    );
  }

  async function appendFailure(
    ctx: ExtensionContext,
    errorMessage: string | undefined,
  ): Promise<void> {
    // Captured once, up front: openTurn is shared module state, and this
    // function now awaits a real snapshot collection. Re-reading openTurn
    // after that await instead of using this captured reference would risk
    // a concurrent agent_settled/before_agent_start clearing or replacing it
    // mid-await, throwing on the writes below or corrupting an unrelated turn.
    const turn = openTurn;
    if (!turn) return;
    const generation = sessionGeneration;
    const turnId = turnGeneration;
    const cwd = ctx.cwd;
    // Record the failure before yielding, so a concurrently settling turn
    // cannot be mistaken for a success while diagnostics collect their hash.
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
      workspaceChangedSinceTurnStart: await workspaceChanged(
        turn.marker.workspaceFingerprint,
        cwd,
      ),
      toolMayHaveMutatedWorkspace: turn.toolMayHaveMutatedWorkspace,
      activeSubagents: turn.activeSubagents,
      settled: false,
    };
    if (
      generation !== sessionGeneration ||
      turnId !== turnGeneration ||
      openTurn !== turn
    )
      return;
    pi.appendEntry("resilience.failure", diagnostic);
  }

  async function collectRecoveryRequired(
    reason: RecoveryRequiredMarker["reason"],
    marker: TurnStartMarker,
    toolMayHaveMutatedWorkspace: boolean,
    cwd: string,
  ): Promise<RecoveryRequiredMarker> {
    return {
      schemaVersion: SCHEMA_VERSION,
      timestamp: new Date().toISOString(),
      turnStartedAt: marker.timestamp,
      reason,
      workspaceChangedSinceTurnStart: await workspaceChanged(
        marker.workspaceFingerprint,
        cwd,
      ),
      toolMayHaveMutatedWorkspace,
    };
  }

  function rememberRecovery(record: RecoveryRequiredMarker): void {
    pendingRecovery = {
      workspaceWasChanged: record.workspaceChangedSinceTurnStart,
      toolMayHaveMutatedWorkspace: record.toolMayHaveMutatedWorkspace,
    };
  }

  pi.on("session_start", async (_event, ctx) => {
    sessionGeneration += 1;
    turnGeneration += 1;
    const generation = sessionGeneration;
    sessionCwd = ctx.cwd;
    activeContext = ctx;
    openTurn = undefined;
    pendingRecovery = undefined;
    const entries = ctx.sessionManager.getBranch();
    // Neustart-Wahrheit zuerst aus den Einträgen: Ein bereits geprüftes Gate
    // behält seinen checked-Zustand über die Sitzung hinaus.
    gate = latestRecoveryGate(entries);
    const prior = latestRecoveryState(entries);
    const start =
      prior.openTurn ??
      (prior.finalFailure
        ? entries
            .map((entry) =>
              customData<TurnStartMarker>(entry, "resilience.turn-start"),
            )
            .find(
              (marker) =>
                marker?.timestamp === prior.finalFailure?.turnStartedAt,
            )
        : undefined);
    if (start) {
      const existing = prior.requiredByTurn.get(start.timestamp);
      const required = await collectRecoveryRequired(
        prior.openTurn ? "interrupted" : "final_failure",
        start,
        existing?.toolMayHaveMutatedWorkspace ?? false,
        ctx.cwd,
      );
      if (generation !== sessionGeneration) return;
      rememberRecovery(required);
      if (!existing) {
        pi.appendEntry("resilience.recovery-required", required);
        gate = { required };
      }
    }
    await updateRecoveryStatus();
  });

  pi.on("before_agent_start", async (_event, ctx) => {
    const generation = sessionGeneration;
    const turnId = ++turnGeneration;
    const cwd = ctx.cwd;
    const recovery = pendingRecovery;
    pendingRecovery = undefined;
    const marker: TurnStartMarker = {
      schemaVersion: SCHEMA_VERSION,
      timestamp: new Date().toISOString(),
      workspaceFingerprint: await workspaceFingerprint(cwd),
      workflowMode: requestWorkflowCapabilities(pi.events).mode ?? "unknown",
      provider: ctx.model?.provider ?? "unknown",
      model: ctx.model?.id ?? "unknown",
      contextPercent: contextPercent(ctx),
    };
    if (generation !== sessionGeneration || turnId !== turnGeneration) return;
    sessionCwd = cwd;
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

  pi.on("tool_execution_start", (event) => {
    if (!openTurn) return;
    openTurn.phase = "tool_running";
    if (isMutatingTool(event.toolName))
      openTurn.toolMayHaveMutatedWorkspace = true;
  });

  pi.on("tool_execution_end", () => {
    if (openTurn) openTurn.phase = "post_tool";
  });

  pi.on("session_before_compact", async (event, ctx) => {
    const generation = sessionGeneration;
    const turnId = turnGeneration;
    if (openTurn) openTurn.phase = "compaction";
    const marker: CompactionBoundaryMarker = {
      schemaVersion: SCHEMA_VERSION,
      timestamp: new Date().toISOString(),
      boundary: "started",
      reason: event.reason,
      willRetry: event.willRetry,
      workspaceFingerprint: await workspaceFingerprint(ctx.cwd),
      workflowMode: requestWorkflowCapabilities(pi.events).mode ?? "unknown",
      contextPercent: contextPercent(ctx),
    };
    if (generation === sessionGeneration && turnId === turnGeneration)
      pi.appendEntry("resilience.compaction-boundary", marker);
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
    const generation = sessionGeneration;
    const turnId = turnGeneration;
    if (openTurn) openTurn.phase = "compaction";
    const marker: CompactionBoundaryMarker = {
      schemaVersion: SCHEMA_VERSION,
      timestamp: new Date().toISOString(),
      boundary: "failed",
      reason: event.reason,
      willRetry: event.willRetry,
      workspaceFingerprint: await workspaceFingerprint(ctx.cwd),
      workflowMode: requestWorkflowCapabilities(pi.events).mode ?? "unknown",
      contextPercent: contextPercent(ctx),
      errorMessage: event.errorMessage,
    };
    if (generation !== sessionGeneration || turnId !== turnGeneration) return;
    pi.appendEntry("resilience.compaction-boundary", marker);
    await appendFailure(ctx, event.errorMessage);
  });

  pi.on("session_compact", async (event, ctx) => {
    const generation = sessionGeneration;
    const turnId = turnGeneration;
    if (openTurn) openTurn.phase = "post_tool";
    const marker: CompactionBoundaryMarker = {
      schemaVersion: SCHEMA_VERSION,
      timestamp: new Date().toISOString(),
      boundary: "completed",
      reason: event.reason,
      willRetry: event.willRetry,
      workspaceFingerprint: await workspaceFingerprint(ctx.cwd),
      workflowMode: requestWorkflowCapabilities(pi.events).mode ?? "unknown",
      contextPercent: contextPercent(ctx),
    };
    if (generation !== sessionGeneration || turnId !== turnGeneration) return;
    pi.appendEntry("resilience.compaction-boundary", marker);
  });

  pi.on("agent_end", async (event, ctx) => {
    const error = lastAssistantError(event);
    if (error && !openTurn?.currentAttemptFailed)
      await appendFailure(ctx, error);
  });

  pi.on("agent_settled", async (_event, ctx) => {
    // Captured once, up front — same reasoning as appendFailure/
    // recoverySnapshot above: this handler now awaits real snapshot
    // collection, and both openTurn and sessionGeneration are shared module
    // state a concurrent session_start could replace mid-await. Re-reading
    // openTurn afterward could clear a brand-new turn instead of this one;
    // the generation check below stops this handler from writing gate/
    // appending entries for a session that has since restarted.
    const turn = openTurn;
    if (!turn) return;
    const generation = sessionGeneration;
    const failed = turn.currentAttemptFailed;
    const turnId = turnGeneration;
    const outcome: TurnSettledMarker["outcome"] = failed
      ? "failed"
      : turn.observedFailureCount > 0
        ? "completed_after_failure"
        : "completed";
    const settled: TurnSettledMarker = {
      schemaVersion: SCHEMA_VERSION,
      timestamp: new Date().toISOString(),
      turnStartedAt: turn.marker.timestamp,
      workspaceFingerprint: await workspaceFingerprint(ctx.cwd),
      outcome,
      observedFailureCount: turn.observedFailureCount,
      ...(failed ? { recoveryPending: true } : {}),
    };
    const required = failed
      ? await collectRecoveryRequired(
          "final_failure",
          turn.marker,
          turn.toolMayHaveMutatedWorkspace,
          ctx.cwd,
        )
      : undefined;
    if (
      generation !== sessionGeneration ||
      turnId !== turnGeneration ||
      openTurn !== turn
    )
      return;
    pi.appendEntry("resilience.turn-settled", settled);
    if (required) {
      rememberRecovery(required);
      pi.appendEntry("resilience.recovery-required", required);
      // Das Gate sperrt nur bei möglicher Mutation; ein Fehlturn ohne jede
      // Workspace-Spur verlangt eine Fortsetzungs-Anweisung, keinen Check.
      gate = gateRequiresInspection(required) ? { required } : undefined;
    }
    openTurn = undefined;
    if (required) await updateRecoveryStatus();
  });

  pi.on("session_shutdown", (_event, ctx) => {
    sessionGeneration += 1;
    turnGeneration += 1;
    openTurn = undefined;
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
    async execute(_id, _params, signal, _onUpdate, ctx) {
      const generation = sessionGeneration;
      const checkedGate = gate;
      const result = await collectWorkspaceSnapshot(ctx.cwd, { signal });
      if (!result.ok) {
        throw new Error(
          `Recovery-Check fehlgeschlagen: Workspace-Snapshot nicht erfassbar ` +
            `(${result.error.code}: ${result.error.message}). Die ` +
            `Schreibsperre bleibt bestehen, bis der Zustand geklärt ist. ` +
            `Nicht-destruktiver Ausweg: prüfe manuell \`git status --short\` ` +
            `und \`git log -1\` in ${ctx.cwd}; behebe die genannte Ursache ` +
            `(z. B. fehlendes Git-Binary, beschädigtes Repository, ` +
            `Berechtigungsproblem) und rufe recovery_check danach erneut auf. ` +
            `Führe keine pauschale Bereinigung (\`git reset --hard\`, ` +
            `\`git clean -fd\`) aus — das kann nicht wiederherstellbare ` +
            `Arbeit löschen.`,
        );
      }
      const snapshot = result.snapshot;
      let gitStatus: string;
      try {
        gitStatus = await gitText(ctx.cwd, ["status", "--short"], signal);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Recovery-Check fehlgeschlagen: git status nicht lesbar (${message}). ` +
            `Die Schreibsperre bleibt bestehen, bis der Zustand geklärt ist. ` +
            `Nicht-destruktiver Ausweg: prüfe manuell \`git status --short\` ` +
            `in ${ctx.cwd} und behebe die genannte Ursache, statt den ` +
            `Workspace pauschal zurückzusetzen.`,
        );
      }
      let diffStat = "";
      try {
        diffStat = await gitText(ctx.cwd, ["diff", "--stat"], signal);
      } catch {
        diffStat = "(Diff-Zusammenfassung nicht verfügbar)";
      }

      if (
        signal?.aborted ||
        generation !== sessionGeneration ||
        gate !== checkedGate
      ) {
        throw new Error(
          "Recovery-Check abgebrochen: Sitzung oder Recovery-Gate hat sich während der Prüfung geändert. Erneut prüfen.",
        );
      }
      const openRequired = checkedGate?.required;
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
      await updateRecoveryStatus();

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
