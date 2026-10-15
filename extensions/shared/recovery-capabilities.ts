/**
 * Promise-aware capability bridge for the resilience recovery gate.
 *
 * Same pattern as verification-capabilities.ts: the permission layer asks, the
 * resilience extension answers during event dispatch. Die Guard-Schicht hält
 * damit keinen eigenen Recovery-Zustand und keine zweite Persistenzquelle —
 * die Wahrheit bleibt bei den Session-Einträgen der Resilience-Extension.
 */

import type { ToolCallEvent } from "@earendil-works/pi-coding-agent";
import { ASK_USER_TOOL_NAME } from "./ask-user-policy.ts";
import { isRecoveryReadOnlyCommand } from "./permission-policy.ts";
import {
  INTERACTIVE_SHELL_TOOL_NAME,
  interactiveShellCommand,
} from "./interactive-shell-policy.ts";

export type RecoveryEffect =
  "read_only" | "potentially_mutating" | "recovery_control";

const READ_ONLY_TOOLS = new Set([
  "read",
  "grep",
  "find",
  "ls",
  ASK_USER_TOOL_NAME,
  "web_search",
  "fetch_content",
  "get_search_content",
  "lsp_diagnostics",
  // Checks may create artifacts; workspace fingerprinting detects changes.
  "project_check",
  "verify",
]);

/** Only known inspection capabilities stay available while recovery is armed. */
export function recoveryEffect(
  event: Pick<ToolCallEvent, "toolName" | "input">,
  cwd: string,
): RecoveryEffect {
  if (event.toolName === "recovery_check") return "recovery_control";
  if (event.toolName === "workspace_add") return "recovery_control";
  if (READ_ONLY_TOOLS.has(event.toolName)) return "read_only";
  if (event.toolName === "subagent") {
    const input = event.input as Record<string, unknown> | undefined;
    const spec = input?.spec as Record<string, unknown> | undefined;
    const profile = spec?.profile;
    if (profile === "analyse" || profile === "research") {
      return "read_only";
    }
  }
  if (
    event.toolName === "bash" ||
    event.toolName === INTERACTIVE_SHELL_TOOL_NAME
  ) {
    const command =
      event.toolName === INTERACTIVE_SHELL_TOOL_NAME
        ? interactiveShellCommand(event as ToolCallEvent)
        : String(
            (event.input as Record<string, unknown> | undefined)?.command ?? "",
          );
    return isRecoveryReadOnlyCommand(command, cwd)
      ? "read_only"
      : "potentially_mutating";
  }
  return "potentially_mutating";
}

export const RECOVERY_CAPABILITY_EVENTS = {
  request: "recovery-status:request",
  mutationApproved: "recovery-mutation:approved",
} as const;

export interface RecoveryMutationApproval extends Pick<
  ToolCallEvent,
  "toolName" | "input"
> {
  toolCallId?: string;
  workspaceRoot?: string;
}

export interface RecoveryStatusSnapshot {
  /** true, solange Schreibzugriffe wegen eines offenen Gates blockiert sind. */
  armed: boolean;
  /** Der Turn, dessen Recovery noch offen ist — für Blocktexte und Status. */
  turnStartedAt?: string;
  /** Warum das Gate scharf ist. */
  reason?:
    "interrupted" | "final_failure" | "workspace-changed" | "unavailable";
  /** Root whose gate state was requested. */
  workspaceRoot?: string;
}

export interface RecoveryStatusRequest {
  workspaceRoot?: string;
  respond(
    snapshot: RecoveryStatusSnapshot | Promise<RecoveryStatusSnapshot>,
  ): void;
}

export interface RecoveryEventBus {
  emit(channel: string, value: unknown): void;
}

export async function requestRecoveryStatus(
  events: RecoveryEventBus,
  workspaceRoot?: string,
): Promise<RecoveryStatusSnapshot> {
  const pending: Promise<unknown>[] = [];
  try {
    events.emit(RECOVERY_CAPABILITY_EVENTS.request, {
      workspaceRoot,
      respond(value: RecoveryStatusSnapshot | Promise<RecoveryStatusSnapshot>) {
        // Attach rejection handlers immediately, including to later replies
        // that may settle while an earlier provider is still being awaited.
        pending.push(Promise.resolve(value).catch(() => undefined));
      },
    } satisfies RecoveryStatusRequest);
  } catch {
    return { armed: true, reason: "unavailable" };
  }
  if (pending.length === 0) return { armed: true, reason: "unavailable" };
  for (const response of pending) {
    const resolved = await response;
    if (isRecoveryStatusSnapshot(resolved)) return resolved;
  }
  // A provider that cannot report its state is not evidence that writes are safe.
  return { armed: true, reason: "unavailable" };
}

export function isRecoveryStatusSnapshot(
  value: unknown,
): value is RecoveryStatusSnapshot {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { armed?: unknown; workspaceRoot?: unknown };
  return (
    typeof candidate.armed === "boolean" &&
    (candidate.workspaceRoot === undefined ||
      typeof candidate.workspaceRoot === "string")
  );
}
