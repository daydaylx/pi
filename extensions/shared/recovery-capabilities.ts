/**
 * Promise-aware capability bridge for the resilience recovery gate.
 *
 * Same pattern as workflow-capabilities.ts: the permission layer asks, the
 * resilience extension answers during event dispatch. Die Guard-Schicht hält
 * damit keinen eigenen Recovery-Zustand und keine zweite Persistenzquelle —
 * die Wahrheit bleibt bei den Session-Einträgen der Resilience-Extension.
 */

import type { ToolCallEvent } from "@earendil-works/pi-coding-agent";
import { ASK_USER_TOOL_NAME } from "./ask-user-policy.ts";
import { isPlanModeDiagnosticCommand } from "./permission-policy.ts";
import {
  INTERACTIVE_SHELL_TOOL_NAME,
  interactiveShellCommand,
} from "./interactive-shell-policy.ts";

export type RecoveryEffect =
  | "read_only"
  | "potentially_mutating"
  | "recovery_control";

const READ_ONLY_TOOLS = new Set([
  "read",
  "grep",
  "find",
  "ls",
  ASK_USER_TOOL_NAME,
  "lsp_diagnostics",
  "lsp_definition",
  "lsp_references",
  "lsp_hover",
  "lsp_workspace_symbols",
]);

/** Known read-only tools stay available; every unclassified capability fails closed. */
export function recoveryEffect(
  event: Pick<ToolCallEvent, "toolName" | "input">,
  cwd: string,
): RecoveryEffect {
  if (event.toolName === "recovery_check") return "recovery_control";
  if (READ_ONLY_TOOLS.has(event.toolName)) return "read_only";
  if (event.toolName === "bash" || event.toolName === INTERACTIVE_SHELL_TOOL_NAME) {
    const command = event.toolName === INTERACTIVE_SHELL_TOOL_NAME
      ? interactiveShellCommand(event as ToolCallEvent)
      : String((event.input as Record<string, unknown> | undefined)?.command ?? "");
    return isPlanModeDiagnosticCommand(command, cwd) ? "read_only" : "potentially_mutating";
  }
  return "potentially_mutating";
}

export const RECOVERY_CAPABILITY_EVENTS = {
  request: "recovery-status:request",
} as const;

export interface RecoveryStatusSnapshot {
  /** true, solange Schreibzugriffe wegen eines offenen Gates blockiert sind. */
  armed: boolean;
  /** Der Turn, dessen Recovery noch offen ist — für Blocktexte und Status. */
  turnStartedAt?: string;
  /** Warum das Gate scharf ist. */
  reason?: "interrupted" | "final_failure" | "workspace-changed" | "unavailable";
}

export interface RecoveryStatusRequest {
  respond(
    snapshot: RecoveryStatusSnapshot | Promise<RecoveryStatusSnapshot>,
  ): void;
}

export interface RecoveryEventBus {
  emit(channel: string, value: unknown): void;
}

export async function requestRecoveryStatus(
  events: RecoveryEventBus,
): Promise<RecoveryStatusSnapshot> {
  const pending: Promise<unknown>[] = [];
  try {
    events.emit(RECOVERY_CAPABILITY_EVENTS.request, {
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
  const candidate = value as { armed?: unknown };
  return typeof candidate.armed === "boolean";
}
