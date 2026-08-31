/**
 * Frontend-Bridge: Bringt Pi-spezifische Core-Zustände (Workflow, Task,
 * Verification, Changes, Subagenten, Permissions, LSP) über die RPC-Grenze,
 * ohne Geschäftslogik im Frontend zu duplizieren (R1/R2/R11).
 *
 * Die Bridge sitzt als gewöhnliche Extension im Pi-Prozess, abonniert die
 * bestehenden EventBus-Kanäle der fachlichen Extensions und persistiert
 * throttele Snapshot-Einträge mit dem Custom-Type "frontend-bridge/state".
 * Diese Einträge streamen im RPC-Modus als entry_appended-Ereignisse in die
 * GUI und überleben gleichzeitig Session-Neustarts.
 *
 * Phase-5-Scope:
 *   - Bus-Felder: workflow, permissions, lsp, changes, verification
 *   - Bus-Events: subagent:async-started/complete/control-event
 *   - Core-Ereignisse: message_start (letzte Nutzereingabe) für task.title
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  isFrontendUiPatchEvent,
  isFrontendUiSnapshotEvent,
  isFrontendUiStateRequest,
  mergeFrontendUiState,
} from "../frontend-protocol/state-helpers.ts";
import {
  FRONTEND_STATE_CHANNELS,
  PROTOCOL_VERSION,
  type FrontendSubagentBranch,
  type FrontendUiState,
  type FrontendUiStatePatch,
  type FrontendUiStateRequest,
} from "../frontend-protocol/state-contract.ts";
import { protocolStateRequest } from "../frontend-protocol/compatibility.ts";
import {
  isPlanningMode,
  workflowModeLabel,
  type WorkflowMode,
} from "../shared/workflow-mode.ts";

const OWNER = "frontend-bridge";
const STATE_ENTRY_TYPE = "frontend-bridge/state";
const FLUSH_MS = 150;
/** Ohne TUI-Aurora feuert niemand den State-Request; die Bridge öffnet die
 * Epoch dann selbst. Die Frist lässt einem echten Frontend den Vortritt. */
const REQUEST_FALLBACK_MS = 400;

interface AsyncSubagentStartEvent {
  id?: unknown;
  sessionId?: unknown;
  agent?: unknown;
  agents?: unknown;
  chain?: unknown;
  mode?: unknown;
}

interface SubagentControlEvent {
  type?: unknown;
  agent?: unknown;
  runId?: unknown;
}

interface SubagentRun {
  runId: string;
  entries: FrontendSubagentBranch[];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string => typeof item === "string" && Boolean(item),
      )
    : [];
}

function defaultState(): FrontendUiState {
  return {
    sessionEpoch: "",
    workflow: { phase: "work", label: workflowModeLabel("work") },
    permissions: {},
    lsp: {},
    model: {},
    activity: { kind: "idle" },
    changes: null,
    verification: null,
    task: { title: "Aktuelle Aufgabe", phaseLabel: "Bereit" },
    subagents: [],
  };
}

function computeTaskTitle(
  workflowPhase: WorkflowMode,
  lastUserPrompt: string | undefined,
): string {
  if (lastUserPrompt) {
    const trimmed = lastUserPrompt.trim().replace(/^[/#]\w+\s*/, "");
    const first = trimmed.split("\n")[0]?.trim() ?? "";
    if (first) return first.length > 60 ? `${first.slice(0, 57)}…` : first;
  }
  if (isPlanningMode(workflowPhase)) return workflowModeLabel(workflowPhase);
  return "Aktuelle Aufgabe";
}

function computeTaskPhaseLabel(
  workflowPhase: WorkflowMode,
  activityKind: FrontendUiState["activity"]["kind"],
): string {
  if (activityKind === "thinking") {
    return isPlanningMode(workflowPhase) ? "Verstehen" : "Analysieren";
  }
  if (activityKind === "tool" || activityKind === "responding")
    return "Arbeiten";
  return workflowModeLabel(workflowPhase);
}

function updateTask(
  state: FrontendUiState,
  lastUserPrompt: string | undefined,
): void {
  state.task = {
    title: computeTaskTitle(state.workflow.phase, lastUserPrompt),
    phaseLabel: computeTaskPhaseLabel(
      state.workflow.phase,
      state.activity.kind,
    ),
  };
}

function flattenSubagents(
  runs: Map<string, FrontendSubagentBranch[]>,
): FrontendSubagentBranch[] {
  const list: FrontendSubagentBranch[] = [];
  for (const entries of runs.values()) list.push(...entries);
  return list;
}

function subagentStartEvent(value: unknown): SubagentRun | undefined {
  const event = record(value) as AsyncSubagentStartEvent;
  const runId = event.id;
  if (typeof runId !== "string") return undefined;
  const agents = [
    ...stringList(event.agents),
    ...stringList(event.chain),
    ...(typeof event.agent === "string" ? [event.agent] : []),
  ];
  const unique = [...new Set(agents)];
  return {
    runId,
    entries: (unique.length > 0 ? unique : ["async"]).map((agent) => ({
      agent,
      role: agent,
      runId,
      status: "queued" as const,
    })),
  };
}

function subagentCompletionId(value: unknown): string | undefined {
  const event = record(value);
  const id = event.id;
  return typeof id === "string" ? id : undefined;
}

function subagentAttention(
  value: unknown,
): { runId: string; agent: string } | undefined {
  const event = record(record(value)?.event) as SubagentControlEvent;
  if (
    event.type !== "needs_attention" ||
    typeof event.runId !== "string" ||
    typeof event.agent !== "string"
  )
    return undefined;
  return { runId: event.runId, agent: event.agent };
}

export default function frontendBridgeExtension(pi: ExtensionAPI): void {
  // The bridge persists transport snapshots for external frontends. Aurora
  // consumes the in-process bus directly, so ordinary CLI/TUI sessions must
  // remain free of frontend transport entries.
  if (process.env.PI_FRONTEND_RPC !== "1") return;
  let state = defaultState();
  let sessionEpoch: string | undefined;
  let sessionId: string | undefined;
  let lastUserPrompt: string | undefined;
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let requestFallbackTimer: ReturnType<typeof setTimeout> | undefined;
  let sawExternalRequest = false;
  const subagentRuns = new Map<string, FrontendSubagentBranch[]>();

  function scheduleFlush(): void {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
      flushTimer = undefined;
      if (!sessionEpoch) return;
      updateTask(state, lastUserPrompt);
      const snapshot: Partial<FrontendUiState> = {
        workflow: state.workflow,
        permissions: state.permissions,
        lsp: state.lsp,
        changes: state.changes,
        verification: state.verification,
        task: state.task,
        subagents: flattenSubagents(subagentRuns),
      };
      pi.appendEntry(STATE_ENTRY_TYPE, {
        v: PROTOCOL_VERSION,
        sessionEpoch,
        sessionId,
        state: snapshot,
      });
    }, FLUSH_MS);
  }

  function applyPatch(patch: FrontendUiStatePatch): void {
    // Der neutrale Merge mutiert state und meldet, ob sich etwas geändert hat.
    // task/subagents werden separat verwaltet und bei Bedarf geflushed.
    const changed = mergeFrontendUiState(state, patch);
    if (changed) scheduleFlush();
  }

  function handleRequest(value: unknown): void {
    const request = value as FrontendUiStateRequest;
    if (!isFrontendUiStateRequest(request) || request.requester === OWNER)
      return;
    if (request.requester !== "frontend-bridge/v1") sawExternalRequest = true;
    sessionEpoch = request.sessionEpoch;
    state.sessionEpoch = sessionEpoch;
  }

  function handlePatch(value: unknown): void {
    if (!isFrontendUiPatchEvent(value) || value.sessionEpoch !== sessionEpoch)
      return;
    applyPatch(value.patch);
  }

  function handleSnapshot(value: unknown): void {
    if (
      !isFrontendUiSnapshotEvent(value) ||
      value.sessionEpoch !== sessionEpoch
    )
      return;
    applyPatch(value.state);
  }

  function handleSubagentStarted(value: unknown): void {
    const started = subagentStartEvent(value);
    if (!started) return;
    subagentRuns.set(started.runId, started.entries);
    scheduleFlush();
  }

  function handleSubagentCompleted(value: unknown): void {
    const runId = subagentCompletionId(value);
    if (!runId || !subagentRuns.delete(runId)) return;
    scheduleFlush();
  }

  function handleSubagentAttention(value: unknown): void {
    const attention = subagentAttention(value);
    if (!attention) return;
    const entries = subagentRuns.get(attention.runId);
    if (!entries) return;
    subagentRuns.set(
      attention.runId,
      entries.map((entry) =>
        entry.agent === attention.agent
          ? { ...entry, status: "needs_attention" as const }
          : entry,
      ),
    );
    scheduleFlush();
  }

  pi.events.on(FRONTEND_STATE_CHANNELS.request, handleRequest);
  pi.events.on(FRONTEND_STATE_CHANNELS.patch, handlePatch);
  pi.events.on(FRONTEND_STATE_CHANNELS.snapshot, handleSnapshot);
  pi.events.on("subagent:async-started", handleSubagentStarted);
  pi.events.on("subagent:async-complete", handleSubagentCompleted);
  pi.events.on("subagent:control-event", handleSubagentAttention);

  pi.on("message_start", (event) => {
    const message = record((event as { message?: unknown }).message);
    if (message.role !== "user") return;
    const content = message.content;
    if (!Array.isArray(content)) return;
    const text = content
      .filter((part) => record(part).type === "text")
      .map((part) => String(record(part).text ?? ""))
      .join("");
    if (text) {
      lastUserPrompt = text;
      scheduleFlush();
    }
  });

  pi.on("session_start", (_event, ctx) => {
    // Ein Wechsel kann in der Runtime unmittelbar auf einen alten Flush
    // folgen. Keine State-Information darf in die neue Session durchsickern.
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = undefined;
    if (requestFallbackTimer) clearTimeout(requestFallbackTimer);
    requestFallbackTimer = undefined;
    sessionEpoch = undefined;
    lastUserPrompt = undefined;
    state = defaultState();
    sessionId = ctx.sessionManager.getSessionId();
    subagentRuns.clear();
    // Ohne ein anderes Frontend (z. B. Aurora im TUI-Modus) öffnet die
    // Bridge die Epoch selbst, damit die Provider im RPC-Modus antworten.
    sawExternalRequest = false;
    requestFallbackTimer = setTimeout(() => {
      requestFallbackTimer = undefined;
      if (sessionEpoch || sawExternalRequest) return;
      const epoch = `bridge-${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      pi.events.emit(
        FRONTEND_STATE_CHANNELS.request,
        protocolStateRequest(`bridge-request:${epoch}`, epoch),
      );
    }, REQUEST_FALLBACK_MS);
  });

  pi.on("session_shutdown", () => {
    sessionId = undefined;
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = undefined;
    if (requestFallbackTimer) clearTimeout(requestFallbackTimer);
    requestFallbackTimer = undefined;
  });
}
