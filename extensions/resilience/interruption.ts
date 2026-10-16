/**
 * Erkennung einer unterbrochenen Ausführung aus den nativen Session-Einträgen.
 *
 * Pi hält den Gesprächsverlauf selbst fest: Ein fehlerhaft oder abgebrochen
 * beendeter Assistentenbeitrag, ein Tool-Aufruf ohne Ergebnis oder
 * Tool-Ergebnisse ohne Folgeantwort sind im Zweig sichtbar. Daraus lässt sich
 * ohne eigenen Zustand ableiten, ob der letzte Lauf endete, bevor das Modell
 * die Wirkung seiner mutierenden Aufrufe bestätigen konnte (ADR 041).
 */
import { ASK_USER_TOOL_NAME } from "../shared/ask-user-policy.ts";
import { INTERACTIVE_SHELL_TOOL_NAME } from "../shared/interactive-shell-policy.ts";
import { isRecoveryReadOnlyCommand } from "../shared/permission-policy.ts";
import { SYSTEM_CONTROL_READ_TOOLS } from "../system-control/tool-names.ts";

export type ToolEffect = "read_only" | "potentially_mutating";

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
  // Wartet nur auf laufende Subagenten, ändert den Workspace nicht.
  "wait",
  // Checks may create artifacts; workspace fingerprinting detects changes.
  "project_check",
  "verify",
  "workspace_add",
]);

/** Nur bekannte lesende Werkzeuge gelten als lesend; Unbekanntes als mutierend. */
export function toolEffect(
  event: { toolName: string; input?: unknown },
  cwd: string,
): ToolEffect {
  const input = event.input as Record<string, unknown> | undefined;
  if (READ_ONLY_TOOLS.has(event.toolName)) return "read_only";
  if (SYSTEM_CONTROL_READ_TOOLS.has(event.toolName)) return "read_only";
  if (
    event.toolName === "system_job" &&
    ["status", "output"].includes(String(input?.action))
  ) {
    return "read_only";
  }
  if (event.toolName === "subagent") {
    const spec = input?.spec as Record<string, unknown> | undefined;
    if (spec?.profile === "analyse" || spec?.profile === "research") {
      return "read_only";
    }
  }
  if (
    event.toolName === "bash" ||
    event.toolName === INTERACTIVE_SHELL_TOOL_NAME
  ) {
    return isRecoveryReadOnlyCommand(String(input?.command ?? ""), cwd)
      ? "read_only"
      : "potentially_mutating";
  }
  return "potentially_mutating";
}

export type InterruptionReason =
  "error" | "aborted" | "no-result" | "no-follow-up";

export interface RunCall {
  name: string;
  /** Befehl, Pfad oder gekürzte Eingabe — genug, um den Aufruf wiederzuerkennen. */
  summary: string;
  outcome: "ok" | "error" | "none";
}

export interface InterruptedRun {
  reason: InterruptionReason;
  errorMessage?: string;
  /** Mutierende Aufrufe des unterbrochenen Laufs, ältester zuerst. */
  calls: RunCall[];
  /** Eintrag, an dem der Lauf endete; verhindert eine Wiederholung des Hinweises. */
  entryId: string;
}

const SUMMARY_MAX = 140;
const CALLS_MAX = 8;

interface MessageRecord {
  id: string;
  message: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function messagesOf(entries: readonly unknown[]): MessageRecord[] {
  const messages: MessageRecord[] = [];
  entries.forEach((entry, index) => {
    if (!isRecord(entry) || entry.type !== "message") return;
    if (!isRecord(entry.message)) return;
    messages.push({
      id: typeof entry.id === "string" ? entry.id : `index-${index}`,
      message: entry.message,
    });
  });
  return messages;
}

function toolCallsOf(
  message: Record<string, unknown>,
): Array<{ id: string; name: string; input: Record<string, unknown> }> {
  if (!Array.isArray(message.content)) return [];
  return message.content.flatMap((block: unknown) =>
    isRecord(block) &&
    block.type === "toolCall" &&
    typeof block.id === "string" &&
    typeof block.name === "string"
      ? [
          {
            id: block.id,
            name: block.name,
            input: isRecord(block.arguments) ? block.arguments : {},
          },
        ]
      : [],
  );
}

function summarizeCall(name: string, input: Record<string, unknown>): string {
  const text =
    name === "bash" || name === INTERACTIVE_SHELL_TOOL_NAME
      ? String(input.command ?? "")
      : typeof input.path === "string"
        ? input.path
        : typeof input.filePath === "string"
          ? input.filePath
          : (JSON.stringify(input) ?? "");
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > SUMMARY_MAX
    ? `${oneLine.slice(0, SUMMARY_MAX)}…`
    : oneLine;
}

/**
 * Der zuletzt unterbrochene Lauf mit mutierenden Aufrufen — oder undefined,
 * wenn der letzte Lauf regulär endete, nur las oder bereits gemeldet wurde.
 */
export function findInterruptedRun(
  entries: readonly unknown[],
  cwd: string,
): InterruptedRun | undefined {
  const messages = messagesOf(entries);
  // Ein noch nicht beantworteter Nutzerprompt am Ende gehört zum neuen Lauf.
  let end = messages.length - 1;
  while (
    end >= 0 &&
    !["assistant", "toolResult"].includes(String(messages[end].message.role))
  ) {
    end -= 1;
  }
  if (end < 0) return undefined;
  const last = messages[end];
  let start = end;
  while (start > 0 && messages[start - 1].message.role !== "user") start -= 1;
  const run = messages.slice(start, end + 1);

  const results = new Map<string, boolean>();
  for (const { message } of run) {
    if (
      message.role === "toolResult" &&
      typeof message.toolCallId === "string"
    ) {
      results.set(message.toolCallId, message.isError === true);
    }
  }

  let reason: InterruptionReason | undefined;
  let errorMessage: string | undefined;
  let lastAssistant: Record<string, unknown> | undefined;
  for (const { message } of run) {
    if (message.role === "assistant") lastAssistant = message;
  }
  const unanswered = (message: Record<string, unknown> | undefined) =>
    message !== undefined &&
    toolCallsOf(message).some((call) => !results.has(call.id));
  if (last.message.role === "assistant") {
    const stopReason = last.message.stopReason;
    if (stopReason === "error" || stopReason === "aborted") {
      reason = stopReason;
      if (typeof last.message.errorMessage === "string") {
        errorMessage = last.message.errorMessage.slice(0, 200);
      }
    } else if (unanswered(last.message)) {
      reason = "no-result";
    }
  } else {
    // Tool-Ergebnisse ohne Folgeantwort; fehlt eines davon, endete die Sitzung mitten im Aufruf.
    reason = unanswered(lastAssistant) ? "no-result" : "no-follow-up";
  }
  if (!reason) return undefined;

  const calls: RunCall[] = [];
  for (const { message } of run) {
    if (message.role !== "assistant") continue;
    // Ein fehlerhaft oder abgebrochen beendeter Beitrag führt seine Aufrufe nicht aus.
    if (message.stopReason === "error" || message.stopReason === "aborted") {
      continue;
    }
    for (const call of toolCallsOf(message)) {
      if (
        toolEffect({ toolName: call.name, input: call.input }, cwd) !==
        "potentially_mutating"
      ) {
        continue;
      }
      calls.push({
        name: call.name,
        summary: summarizeCall(call.name, call.input),
        outcome: results.has(call.id)
          ? results.get(call.id)
            ? "error"
            : "ok"
          : "none",
      });
    }
  }
  if (calls.length === 0) return undefined;

  const noticed = entries.some(
    (entry) =>
      isRecord(entry) &&
      entry.type === "custom" &&
      entry.customType === "resilience.interruption-notice" &&
      isRecord(entry.data) &&
      entry.data.entryId === last.id,
  );
  if (noticed) return undefined;

  return {
    reason,
    ...(errorMessage ? { errorMessage } : {}),
    calls: calls.slice(-CALLS_MAX),
    entryId: last.id,
  };
}

const REASON_TEXT: Record<InterruptionReason, string> = {
  error: "endete mit einem Provider- oder Streamfehler",
  aborted: "wurde abgebrochen",
  "no-result": "endete während eines Tool-Aufrufs",
  "no-follow-up": "endete nach Tool-Ergebnissen ohne Antwort",
};

const OUTCOME_TEXT: Record<RunCall["outcome"], string> = {
  ok: "Ergebnis: ok",
  error: "Ergebnis: Fehler",
  none: "kein Ergebnis — Ausgang unbekannt",
};

/** Versteckter Hinweis an das Modell: Fakten zum Lauf, kein Befehl zum Blockieren. */
export function formatInterruptionNotice(
  run: InterruptedRun,
  workspaceReport: string,
): string {
  return [
    `Die vorherige Ausführung ${REASON_TEXT[run.reason]}${run.errorMessage ? ` (${run.errorMessage})` : ""}. Ihre mutierenden Aufrufe und deren Stand:`,
    ...run.calls.map(
      (call) =>
        `- ${call.name}: ${call.summary} — ${OUTCOME_TEXT[call.outcome]}`,
    ),
    "",
    workspaceReport,
    "",
    "Behandle jeden Aufruf ohne Ergebnis als möglicherweise ausgeführt: prüfe den Zustand, bevor du ihn wiederholst. Setze danach den Nutzerauftrag fort.",
  ].join("\n");
}
