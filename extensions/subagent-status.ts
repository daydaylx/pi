/**
 * Minimal Zentui status publisher for the externally maintained pi-subagents
 * package. It owns no TUI chrome: Zentui renders the footer, while
 * pi-subagents continues to render its temporary activity widget itself.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  ZENTUI_STATUS_KEYS,
  setTuiStatus,
} from "./shared/workflow-status.ts";

const ASYNC_COMPLETE_EVENT = "subagent:async-complete";
const ASYNC_STARTED_EVENT = "subagent:async-started";
const RPC_READY_EVENT = "subagents:rpc:v1:ready";
const RPC_REPLY_EVENT_PREFIX = "subagents:rpc:v1:reply:";
const RPC_REQUEST_EVENT = "subagents:rpc:v1:request";

type RpcStatusReply = {
  version?: unknown;
  requestId?: unknown;
  success?: unknown;
  data?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function eventRunId(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  return nonEmptyString(payload.id) ?? nonEmptyString(payload.runId);
}

function eventSessionId(payload: unknown): string | undefined {
  return isRecord(payload) ? nonEmptyString(payload.sessionId) : undefined;
}

function isSubagentRun(args: unknown): boolean {
  return !isRecord(args) || args.action === undefined;
}

/**
 * v0.34.0's documented v1 RPC returns bare `status` as presentation text.
 * This parser is deliberately limited to the two public status headers that
 * let a newly restored session avoid falsely claiming that it is idle. Live
 * activity is always tracked by the documented lifecycle events instead.
 */
function restoredAsyncRunCount(text: string): number | "unknown" | undefined {
  const trimmed = text.trim();
  if (trimmed === "No active async runs.") return 0;
  const match = /^Active async runs:\s+(\d+)\s*(?:\r?\n|$)/.exec(text);
  if (match) return Number(match[1]);
  return trimmed ? "unknown" : undefined;
}

export default function subagentStatusExtension(pi: ExtensionAPI): void {
  const asyncRunIds = new Set<string>();
  const foregroundToolCallIds = new Set<string>();
  const eventUnsubscribes: Array<() => void> = [];
  const pendingReplyUnsubscribes = new Set<() => void>();
  let activeContext: ExtensionContext | undefined;
  let activeSessionId: string | undefined;
  let packageReady = false;
  let restoredCount = 0;
  let restoredCountUnknown = false;
  let asyncLifecycleVersion = 0;
  let requestSequence = 0;
  let sessionEpoch = 0;

  function publish(): void {
    if (!activeContext) return;
    if (restoredCountUnknown) {
      setTuiStatus(activeContext, ZENTUI_STATUS_KEYS.subagents, "SUB: active");
      return;
    }

    const count =
      foregroundToolCallIds.size + asyncRunIds.size + restoredCount;
    setTuiStatus(
      activeContext,
      ZENTUI_STATUS_KEYS.subagents,
      count === 0 ? "SUB: idle" : `SUB: ${count} active`,
    );
  }

  function belongsToActiveSession(payload: unknown): boolean {
    const payloadSessionId = eventSessionId(payload);
    return !activeSessionId || !payloadSessionId || payloadSessionId === activeSessionId;
  }

  function clearPendingReplies(): void {
    for (const unsubscribe of pendingReplyUnsubscribes) unsubscribe();
    pendingReplyUnsubscribes.clear();
  }

  function applyRestoredStatus(reply: RpcStatusReply): void {
    if (reply.version !== 1 || reply.success !== true || !isRecord(reply.data)) {
      return;
    }
    const text = reply.data.text;
    if (typeof text !== "string") return;

    const count = restoredAsyncRunCount(text);
    if (typeof count === "number") {
      // A launch can race the bootstrap reply. Those IDs are already counted
      // by lifecycle events, so retain only the restored remainder here.
      restoredCount = Math.max(0, count - asyncRunIds.size);
      restoredCountUnknown = false;
    } else if (count === "unknown") {
      // Forward-compatible failure mode: an unfamiliar successful public
      // status must never be displayed as "idle".
      restoredCountUnknown = true;
    }
    publish();
  }

  function requestRestoredStatus(): void {
    const contextAtRequest = activeContext;
    if (!contextAtRequest || !packageReady) return;

    // There is no structured restore snapshot in the public v1 protocol. Do
    // not claim that the fleet is idle while its status request is outstanding
    // (or if a future package version replies with an error).
    restoredCount = 0;
    restoredCountUnknown = true;
    publish();

    // Only the newest snapshot can safely contribute a count. The public
    // protocol exposes no run IDs, so a lifecycle change while a reply is in
    // flight makes that reply ambiguous (it may or may not include the run).
    clearPendingReplies();
    const lifecycleVersionAtRequest = asyncLifecycleVersion;
    const sessionEpochAtRequest = sessionEpoch;
    const requestId = `subagent-status-${Date.now()}-${++requestSequence}`;
    const replyEvent = `${RPC_REPLY_EVENT_PREFIX}${requestId}`;
    let unsubscribe: (() => void) | undefined;
    const handleReply = (payload: unknown): void => {
      const reply = isRecord(payload) ? (payload as RpcStatusReply) : undefined;
      if (!reply || reply.requestId !== requestId) return;
      if (unsubscribe) {
        pendingReplyUnsubscribes.delete(unsubscribe);
        unsubscribe();
      }
      if (
        activeContext !== contextAtRequest ||
        sessionEpoch !== sessionEpochAtRequest
      ) {
        return;
      }
      if (asyncLifecycleVersion !== lifecycleVersionAtRequest) {
        requestRestoredStatus();
        return;
      }
      applyRestoredStatus(reply);
    };

    unsubscribe = pi.events.on(replyEvent, handleReply);
    pendingReplyUnsubscribes.add(unsubscribe);
    pi.events.emit(RPC_REQUEST_EVENT, {
      version: 1,
      requestId,
      method: "status",
      params: {},
      source: { extension: "subagent-status" },
    });
  }

  eventUnsubscribes.push(
    pi.events.on(RPC_READY_EVENT, () => {
      packageReady = true;
      requestRestoredStatus();
    }),
    pi.events.on(ASYNC_STARTED_EVENT, (payload) => {
      if (!activeContext || !belongsToActiveSession(payload)) return;
      const id = eventRunId(payload);
      if (!id) return;
      if (asyncRunIds.has(id)) return;
      asyncRunIds.add(id);
      asyncLifecycleVersion += 1;
      if (restoredCountUnknown) requestRestoredStatus();
      else publish();
    }),
    pi.events.on(ASYNC_COMPLETE_EVENT, (payload) => {
      if (!activeContext || !belongsToActiveSession(payload)) return;
      const id = eventRunId(payload);
      if (!id) return;
      asyncLifecycleVersion += 1;
      if (asyncRunIds.delete(id)) {
        if (restoredCountUnknown) {
          requestRestoredStatus();
          return;
        }
        publish();
        return;
      }

      // The v1 bootstrap response gives only a count, not stable restored run
      // IDs. A completion we cannot match must not decrement that count and
      // accidentally reach idle while another restored child is still alive.
      restoredCount = 0;
      restoredCountUnknown = true;
      requestRestoredStatus();
    }),
  );

  pi.on("session_start", (_event, ctx) => {
    sessionEpoch += 1;
    clearPendingReplies();
    activeContext = ctx;
    activeSessionId = ctx.sessionManager.getSessionId() ?? undefined;
    asyncRunIds.clear();
    foregroundToolCallIds.clear();
    restoredCount = 0;
    restoredCountUnknown = false;
    asyncLifecycleVersion = 0;
    publish();
    if (packageReady) requestRestoredStatus();
  });

  pi.on("tool_execution_start", (event, ctx) => {
    if (event.toolName !== "subagent" || !isSubagentRun(event.args)) return;
    activeContext = ctx;
    foregroundToolCallIds.add(event.toolCallId);
    publish();
  });

  pi.on("tool_execution_end", (event) => {
    if (event.toolName !== "subagent") return;
    if (foregroundToolCallIds.delete(event.toolCallId)) publish();
  });

  pi.on("session_shutdown", (_event, ctx) => {
    sessionEpoch += 1;
    setTuiStatus(ctx, ZENTUI_STATUS_KEYS.subagents, undefined);
    clearPendingReplies();
    for (const unsubscribe of eventUnsubscribes) unsubscribe();
    asyncRunIds.clear();
    foregroundToolCallIds.clear();
    activeContext = undefined;
    activeSessionId = undefined;
    packageReady = false;
    restoredCount = 0;
    restoredCountUnknown = false;
    asyncLifecycleVersion = 0;
  });
}
