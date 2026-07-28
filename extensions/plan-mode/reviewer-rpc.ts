import { randomUUID } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { parseCompletionReviewerResult } from "./completion/reviewer-check.ts";
import type {
  CompletionReviewerInput,
  CompletionReviewerResult,
} from "./completion/types.ts";

interface RpcReply {
  ok?: boolean;
  success?: boolean;
  result?: unknown;
  data?: unknown;
  error?: unknown;
}

const RPC_REQUEST = "subagents:rpc:v1:request";
const RPC_REPLY_PREFIX = "subagents:rpc:v1:reply:";

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function firstString(
  value: unknown,
  keys: readonly string[],
): string | undefined {
  return findString(value, new Set(keys), new Set(), 0);
}

function findString(
  value: unknown,
  keys: ReadonlySet<string>,
  seen: Set<object>,
  depth: number,
): string | undefined {
  if (depth > 8 || !value || typeof value !== "object") return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const entry of value) {
      const candidate = findString(entry, keys, seen, depth + 1);
      if (candidate) return candidate;
    }
    return undefined;
  }
  const object = record(value);
  if (!object) return undefined;
  for (const key of keys) {
    const candidate = object[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  for (const nested of Object.values(object)) {
    const candidate = findString(nested, keys, seen, depth + 1);
    if (candidate) return candidate;
  }
  return undefined;
}

function reviewerTask(input: CompletionReviewerInput): string {
  const plan =
    input.plan?.content ??
    (input.directTask
      ? [
          "# Direct Task",
          `Ziel: ${input.directTask.goal}`,
          "Technischer Scope:",
          ...input.directTask.technicalScope.map((entry) => `- ${entry}`),
          "Abschlusskriterien:",
          ...input.directTask.acceptanceCriteria.map((entry) => `- ${entry}`),
        ].join("\n")
      : "Kein Plan oder Direct Task verfügbar.");
  const checks = input.checks
    .map(
      (check) =>
        `- [${check.classification}/${check.status}] ${check.name}: ${check.summary}`,
    )
    .join("\n");
  const files = input.changedFiles
    .map((file) => `- ${file.status} ${file.path}`)
    .join("\n");
  return [
    "Prüfe den folgenden Abschluss unabhängig und ausschließlich lesend.",
    "Fokus: general, security und architecture (ausdrücklicher Multi-Fokus-Completion-Review).",
    "Bewerte Plan-/Task-Erfüllung, Scope, Diff und vorliegende Checks.",
    "Keine Dateien ändern, keine Commits und keine neuen Anforderungen erfinden.",
    "",
    "Deine letzte nichtleere Zeile MUSS exakt einer dieser Marker sein:",
    "[COMPLETION-REVIEW:PASS]",
    "[COMPLETION-REVIEW:REWORK]",
    "[COMPLETION-REVIEW:UNVERIFIABLE]",
    "",
    "Plan/Task:",
    plan,
    "",
    `Diff-Fingerprint: ${input.diffHash}`,
    "Geänderte Dateien:",
    files || "- keine",
    "",
    "Scope-Befunde:",
    input.scopeFindings.map((entry) => `- ${entry}`).join("\n") || "- keine",
    "",
    "Checks:",
    checks || "- keine",
    "",
    "Diff (begrenzt; untracked Inhalte werden nicht eingebettet):",
    input.diff || "(kein eingebetteter Diff)",
  ].join("\n");
}

async function rpc(
  pi: ExtensionAPI,
  method: string,
  params: Record<string, unknown>,
  timeoutMs = 15_000,
): Promise<RpcReply> {
  const requestId = randomUUID();
  const channel = `${RPC_REPLY_PREFIX}${requestId}`;
  return await new Promise<RpcReply>((resolve, reject) => {
    let settled = false;
    const unsubscribe = pi.events.on(channel, (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe?.();
      resolve((record(value) ?? {}) as RpcReply);
    });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      unsubscribe?.();
      reject(new Error(`Subagent-RPC ${method} antwortete nicht rechtzeitig.`));
    }, timeoutMs);
    pi.events.emit(RPC_REQUEST, {
      version: 1,
      requestId,
      method,
      params,
    });
  });
}

function replyPayload(reply: RpcReply): unknown {
  if (reply.ok === false || reply.success === false) {
    throw new Error(
      firstString(reply.error, ["message", "error"]) ??
        firstString(reply, ["error", "message"]) ??
        "Subagent-RPC meldete einen Fehler.",
    );
  }
  return reply.result ?? reply.data ?? reply;
}

function terminalState(value: unknown): string | undefined {
  return firstString(value, ["status", "state", "phase"])?.toLowerCase();
}

function reviewerOutput(value: unknown): string | undefined {
  return (
    firstString(value, ["output", "text", "transcript", "final", "message"]) ??
    firstString(value, ["summary"])
  );
}

export async function runCompletionReviewerViaRpc(
  pi: ExtensionAPI,
  input: CompletionReviewerInput,
  options: { pollMs?: number; timeoutMs?: number } = {},
): Promise<CompletionReviewerResult> {
  const pollMs = Math.max(100, options.pollMs ?? 750);
  const timeoutMs = Math.max(5_000, options.timeoutMs ?? 15 * 60_000);
  try {
    const spawned = replyPayload(
      await rpc(pi, "spawn", {
        agent: "reviewer",
        task: reviewerTask(input),
        context: "fresh",
        async: true,
        clarify: false,
      }),
    );
    const runId = firstString(spawned, ["runId", "id", "agentId"]);
    if (!runId) {
      return {
        verdict: "UNVERIFIABLE",
        summary: "Reviewer wurde gestartet, lieferte aber keine Run-ID.",
      };
    }
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const status = replyPayload(
        await rpc(pi, "status", { action: "status", id: runId }),
      );
      const state = terminalState(status);
      const output = reviewerOutput(status);
      if (
        state &&
        ["completed", "complete", "done", "succeeded", "success"].includes(
          state,
        )
      ) {
        return parseCompletionReviewerResult(output ?? "");
      }
      if (
        state &&
        [
          "failed",
          "error",
          "interrupted",
          "stopped",
          "cancelled",
          "paused",
        ].includes(state)
      ) {
        return {
          verdict: "UNVERIFIABLE",
          summary: output ?? `Reviewer endete mit Status ${state}.`,
          ...(output ? { raw: output } : {}),
        };
      }
      await new Promise<void>((resolve) => setTimeout(resolve, pollMs));
    }
    return {
      verdict: "UNVERIFIABLE",
      summary: `Reviewer-Timeout nach ${Math.round(timeoutMs / 1000)} Sekunden.`,
    };
  } catch (error) {
    return {
      verdict: "UNVERIFIABLE",
      summary: error instanceof Error ? error.message : String(error),
    };
  }
}
