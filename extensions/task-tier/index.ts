/**
 * task-tier — Duplicate-Read-Guard und Turn-Telemetrie
 * (docs/decisions/039-task-tier-vereinfacht.md).
 *
 * Die frühere FAST/NORMAL/DEEP-Klassifikation (Prompt-Zusatz, automatische
 * Thinking-Änderung, ausgeblendete Subagenten-Tools, Eskalation) ist entfallen:
 * Thinking, Subagenten und Verifier regeln Nutzerwahl und Permission-Schicht.
 * Übrig bleiben zwei beobachtbare Funktionen:
 *
 * - ein `read`, dessen Zeilenbereich bereits von einer früheren, nicht
 *   gekürzten Ausgabe derselben unveränderten Datei (mtime/Größe) abgedeckt
 *   ist, wird blockiert; `edit`/`write` invalidieren, Kompaktierung und
 *   Sitzungsstart setzen zurück;
 * - pro Lauf ein Session-Eintrag `task-tier.turn` mit Aufrufzählern, Tokens
 *   und Cache-Verlusten.
 *
 * Rückbau: Eintrag `+extensions/task-tier/index.ts` aus settings.json und
 * knip.json entfernen, Erwartungslisten in tests/suites/runtime/target-config.mjs,
 * tests/suites/runtime/resilience.mjs und tests/coverage-baseline.json anpassen.
 */
import { statSync } from "node:fs";
import { resolve } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { subagentLaunchCount } from "../permissions/temporary-agent-policy.ts";
import { createReadTracker } from "./read-tracker.ts";

export const TASK_TIER_ENTRY = "task-tier.turn";

const SEARCH_TOOLS = new Set(["grep", "find", "ls"]);
const EDIT_TOOLS = new Set(["edit", "write"]);
const COMMAND_TOOLS = new Set(["bash", "project_check"]);

/** Ein Cache-Verlust: der Cache-Anteil fällt auf unter die Hälfte des vorherigen Requests. */
export const CACHE_MISS_RATIO = 0.5;

interface TurnState {
  startedAt: number;
  searches: number;
  reads: number;
  dupReadsBlocked: number;
  edits: number;
  editedFiles: Set<string>;
  commands: number;
  subagentCalls: number;
  verifierCalls: number;
  requests: number;
  inputTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  cacheMisses: number;
  slowestRequestMs: number;
  lastMessageEndAt: number;
  lastCacheRead: number;
}

function newTurn(): TurnState {
  return {
    startedAt: Date.now(),
    searches: 0,
    reads: 0,
    dupReadsBlocked: 0,
    edits: 0,
    editedFiles: new Set(),
    commands: 0,
    subagentCalls: 0,
    verifierCalls: 0,
    requests: 0,
    inputTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
    cacheMisses: 0,
    slowestRequestMs: 0,
    lastMessageEndAt: Date.now(),
    lastCacheRead: 0,
  };
}

function inputPath(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const record = input as Record<string, unknown>;
  const value = record.path ?? record.filePath;
  return typeof value === "string" ? value : undefined;
}

function isVerifierCall(input: unknown): boolean {
  if (!input || typeof input !== "object") return false;
  const record = input as {
    agent?: unknown;
    spec?: { profile?: unknown } | null;
  };
  return record.agent === "verifier" || record.spec?.profile === "verify";
}

function stampOf(absolute: string) {
  try {
    const stat = statSync(absolute);
    return { mtimeMs: stat.mtimeMs, size: stat.size };
  } catch {
    return undefined;
  }
}

export default function taskTier(pi: ExtensionAPI): void {
  const tracker = createReadTracker();
  let turn: TurnState | undefined;

  pi.on("session_start", () => {
    tracker.reset();
    turn = undefined;
  });
  pi.on("session_compact", () => tracker.reset());
  pi.on("agent_start", () => {
    turn = newTurn();
  });

  pi.on("tool_call", (event, ctx: ExtensionContext) => {
    const name = event.toolName;

    if (name === "subagent") {
      if (!turn) return;
      const launches = subagentLaunchCount(event);
      turn.subagentCalls += launches;
      if (launches > 0 && isVerifierCall(event.input)) turn.verifierCalls += 1;
      return;
    }

    if (name !== "read") return;
    const path = inputPath(event.input);
    if (!path) return;
    const absolute = resolve(ctx.cwd, path);
    const stamp = stampOf(absolute);
    const input = event.input as { offset?: number; limit?: number };
    if (
      stamp &&
      tracker.isRedundant(
        absolute,
        { offset: input.offset, limit: input.limit },
        stamp,
      )
    ) {
      if (turn) turn.dupReadsBlocked += 1;
      return {
        block: true,
        reason: `Datei unverändert und dieser Bereich wurde bereits gelesen (${path}); der Inhalt steht im Kontext. Nicht erneut lesen.`,
      };
    }
  });

  pi.on("tool_result", (event, ctx: ExtensionContext) => {
    const name = event.toolName;
    if (turn) {
      if (SEARCH_TOOLS.has(name)) turn.searches += 1;
      else if (COMMAND_TOOLS.has(name)) turn.commands += 1;
      else if (name === "read") turn.reads += 1;
      else if (EDIT_TOOLS.has(name)) turn.edits += 1;
    }

    const path = inputPath(event.input);
    if (!path) return;
    const absolute = resolve(ctx.cwd, path);
    if (EDIT_TOOLS.has(name)) {
      tracker.invalidate(absolute);
      turn?.editedFiles.add(path);
      return;
    }
    if (name === "read" && !event.isError) {
      const stamp = stampOf(absolute);
      const input = event.input as { offset?: number; limit?: number };
      const details = (event as { details?: { truncation?: unknown } }).details;
      const truncated = Boolean(
        (details?.truncation as { truncated?: boolean } | undefined)?.truncated,
      );
      if (stamp)
        tracker.record(
          absolute,
          { offset: input.offset, limit: input.limit },
          stamp,
          truncated,
        );
    }
  });

  // Nur beobachten: Tokens, Cache-Verluste und langsamste Antwort je Lauf.
  pi.on("message_end", (event) => {
    if (!turn) return;
    const message = (
      event as { message?: { role?: string; usage?: Record<string, unknown> } }
    ).message;
    const now = Date.now();
    if (message?.role === "assistant") {
      const usage = message.usage ?? {};
      const num = (value: unknown) =>
        typeof value === "number" && Number.isFinite(value) ? value : 0;
      const cacheRead = num(usage.cacheRead);
      turn.requests += 1;
      turn.inputTokens += num(usage.input);
      turn.cacheReadTokens += cacheRead;
      turn.outputTokens += num(usage.output);
      if (
        turn.lastCacheRead > 0 &&
        cacheRead < turn.lastCacheRead * CACHE_MISS_RATIO
      )
        turn.cacheMisses += 1;
      turn.lastCacheRead = cacheRead;
      turn.slowestRequestMs = Math.max(
        turn.slowestRequestMs,
        now - turn.lastMessageEndAt,
      );
    }
    turn.lastMessageEndAt = now;
  });

  pi.on("agent_end", () => {
    const state = turn;
    if (!state) return;
    turn = undefined;
    pi.appendEntry(TASK_TIER_ENTRY, {
      schemaVersion: 2,
      timestamp: new Date().toISOString(),
      searches: state.searches,
      reads: state.reads,
      dupReadsBlocked: state.dupReadsBlocked,
      edits: state.edits,
      editedFiles: state.editedFiles.size,
      commands: state.commands,
      subagentCalls: state.subagentCalls,
      verifierCalls: state.verifierCalls,
      durationMs: Date.now() - state.startedAt,
      requests: state.requests,
      inputTokens: state.inputTokens,
      cacheReadTokens: state.cacheReadTokens,
      outputTokens: state.outputTokens,
      cacheMisses: state.cacheMisses,
      slowestRequestMs: state.slowestRequestMs,
    });
  });
}
