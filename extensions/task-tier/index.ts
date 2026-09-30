/**
 * task-tier — FAST/NORMAL/DEEP-Routing für weniger Overhead bei einfachen
 * Aufgaben (docs/decisions/033-task-tiers.md).
 *
 * Rückbau: Eintrag `+extensions/task-tier/index.ts` aus settings.json
 * entfernen; alle anderen Mechanismen bleiben unverändert.
 */
import { statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { matchingVerifierRequiredPaths } from "../permissions/verifier-required-paths.ts";
import { subagentLaunchCount } from "../permissions/temporary-agent-policy.ts";
import {
  clearAutoThinking,
  expectAutoThinking,
} from "../shared/auto-thinking.ts";
import { isPlanningMode } from "../shared/workflow-mode.ts";
import { requestWorkflowCapabilities } from "../shared/workflow-capabilities.ts";
import {
  classifyPrompt,
  isHigherThan,
  isLowerThan,
  thinkingForTier,
  type TaskTier,
} from "./classify.ts";
import { createReadTracker } from "./read-tracker.ts";

export const TASK_TIER_ENTRY = "task-tier.turn";

/** Eskalationsschwellen vor dem ersten Edit bzw. insgesamt. */
export const MAX_FAST_SEARCHES = 2;
export const MAX_FAST_READS = 6;
export const MAX_FAST_EDITED_FILES = 3;

const SEARCH_TOOLS = new Set(["grep", "find", "ls"]);
const EDIT_TOOLS = new Set(["edit", "write"]);
const COMMAND_TOOLS = new Set(["bash", "project_check"]);

const STOP_RULE =
  "Stop-Regel: Sind die Akzeptanzkriterien erfüllt, der gezielte Test erfolgreich und keine Unsicherheit offen, beende die Aufgabe. Danach keine erneuten Reads, Zusatz-Refactorings, weiteren Tests oder Doku-Änderungen ohne Anlass; ausdrückliche Nutzerwünsche haben Vorrang.";

const FAST_PROMPT = [
  "## Aufgabenklasse: FAST (automatisch erkannt)",
  "Lokale, risikoarme Aufgabe. Ablauf: inspect → edit → gezielter Check → fertig.",
  "- Vor dem ersten Edit höchstens ~2 Suchen und 3–5 Datei-Reads; keine allgemeine Architekturerkundung.",
  "- Lies eine Datei einmal in einem ausreichend großen zusammenhängenden Bereich statt in vielen kleinen Ausschnitten; kein erneuter Read unveränderter Dateien.",
  "- Keine Subagenten und kein Verifier. Prüfe die Änderung selbst mit dem direkt zugehörigen Test bzw. Syntax-/Typecheck; kein globales `verify` ohne Anlass.",
  "- Zeigt sich echte Komplexität (mehrere Subsysteme, Security/Permissions, öffentlicher Vertrag), arbeite normal weiter; die Klasse wird dann automatisch hochgestuft.",
  STOP_RULE,
].join("\n");

const DEEP_PROMPT = [
  "## Aufgabenklasse: DEEP (automatisch erkannt)",
  "Ausführliche Exploration, Subagenten, Verifier und umfassendere Tests sind erlaubt und bei Risiko erwünscht.",
  STOP_RULE,
].join("\n");

interface TurnState {
  tier: TaskTier;
  startedAt: number;
  startedThinking: string | undefined;
  autoThinking: string | undefined;
  searches: number;
  reads: number;
  dupReadsBlocked: number;
  edits: number;
  editedFiles: Set<string>;
  commands: number;
  subagentCalls: number;
  verifierCalls: number;
  escalations: string[];
}

function newTurn(tier: TaskTier): TurnState {
  return {
    tier,
    startedAt: Date.now(),
    startedThinking: undefined,
    autoThinking: undefined,
    searches: 0,
    reads: 0,
    dupReadsBlocked: 0,
    edits: 0,
    editedFiles: new Set(),
    commands: 0,
    subagentCalls: 0,
    verifierCalls: 0,
    escalations: [],
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
  let editedFirst = false;

  const setAutoThinking = (level: string) => {
    if (!turn || pi.getThinkingLevel() === level) return;
    expectAutoThinking(level);
    pi.setThinkingLevel(level as ReturnType<typeof pi.getThinkingLevel>);
    turn.autoThinking = pi.getThinkingLevel();
  };

  const escalate = (to: TaskTier, reason: string) => {
    if (!turn || turn.tier === "deep" || turn.tier === to) return;
    if (to === "fast") return;
    turn.escalations.push(`${turn.tier}->${to}: ${reason}`);
    turn.tier = to;
    const started = turn.startedThinking;
    if (to === "deep") {
      if (isHigherThan("high", pi.getThinkingLevel())) setAutoThinking("high");
    } else if (started && turn.autoThinking !== undefined) {
      setAutoThinking(started);
    }
    pi.sendMessage(
      {
        customType: "task-tier.escalation",
        content: `Aufgabenklasse auf ${to.toUpperCase()} hochgestuft (${reason}). Subagenten und Verifier sind nach Bedarf wieder erlaubt; arbeite mit der bisherigen Sorgfalt weiter.`,
        display: false,
      },
      { deliverAs: "steer" },
    );
  };

  pi.on("session_start", () => {
    tracker.reset();
    turn = undefined;
    editedFirst = false;
    clearAutoThinking();
  });
  pi.on("session_compact", () => tracker.reset());

  pi.on("before_agent_start", async (event) => {
    const planning = isPlanningMode(
      requestWorkflowCapabilities(pi.events).mode ?? "work",
    );
    const tier = classifyPrompt(event.prompt, { planning });
    turn = newTurn(tier);
    editedFirst = false;
    clearAutoThinking();
    turn.startedThinking = pi.getThinkingLevel();
    const target = thinkingForTier(tier, event.prompt);
    if (target) {
      const current = pi.getThinkingLevel();
      const apply =
        tier === "fast"
          ? isLowerThan(target, current)
          : isHigherThan(target, current);
      if (apply) setAutoThinking(target);
    }
    if (tier === "normal") return;
    return {
      systemPrompt: `${event.systemPrompt}\n\n${tier === "fast" ? FAST_PROMPT : DEEP_PROMPT}`,
    };
  });

  pi.on("tool_call", (event, ctx: ExtensionContext) => {
    if (!turn) return;
    const name = event.toolName;

    if (name === "subagent") {
      const launches = subagentLaunchCount(event);
      if (launches > 0 && turn.tier === "fast") {
        return {
          block: true,
          reason:
            "FAST-Aufgabe: keine Subagenten und kein Verifier. Erledige die Arbeit selbst. Wirkt sie größer als erwartet, arbeite mit Reads/Edits weiter; die Klasse wird dann automatisch hochgestuft.",
        };
      }
      turn.subagentCalls += launches;
      if (launches > 0 && isVerifierCall(event.input)) turn.verifierCalls += 1;
      return;
    }

    if (name === "read" && turn.tier !== "deep") {
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
        turn.dupReadsBlocked += 1;
        return {
          block: true,
          reason: `Datei unverändert und dieser Bereich wurde bereits gelesen (${path}); der Inhalt steht im Kontext. Nicht erneut lesen.`,
        };
      }
    }
  });

  pi.on("tool_result", (event, ctx: ExtensionContext) => {
    if (!turn) return;
    const name = event.toolName;
    if (SEARCH_TOOLS.has(name)) turn.searches += 1;
    else if (COMMAND_TOOLS.has(name)) turn.commands += 1;
    else if (name === "read") {
      turn.reads += 1;
      const path = inputPath(event.input);
      if (path && !event.isError) {
        const absolute = resolve(ctx.cwd, path);
        const stamp = stampOf(absolute);
        const input = event.input as { offset?: number; limit?: number };
        const details = (event as { details?: { truncation?: unknown } })
          .details;
        const truncated = Boolean(
          (details?.truncation as { truncated?: boolean } | undefined)
            ?.truncated,
        );
        if (stamp)
          tracker.record(
            absolute,
            { offset: input.offset, limit: input.limit },
            stamp,
            truncated,
          );
      }
    } else if (EDIT_TOOLS.has(name)) {
      turn.edits += 1;
      const path = inputPath(event.input);
      if (path) {
        const absolute = resolve(ctx.cwd, path);
        tracker.invalidate(absolute);
        const rel = relative(ctx.cwd, absolute);
        const inside = !rel.startsWith("..") && !isAbsolute(rel);
        turn.editedFiles.add(rel);
        if (inside && matchingVerifierRequiredPaths([rel]).length > 0) {
          escalate("deep", `Hard-Verifier-Pfad geändert: ${rel}`);
        } else if (turn.editedFiles.size > MAX_FAST_EDITED_FILES) {
          escalate("normal", `mehr als ${MAX_FAST_EDITED_FILES} Dateien`);
        }
      }
      editedFirst = true;
    }
    if (turn.tier === "fast" && !editedFirst) {
      if (turn.searches > MAX_FAST_SEARCHES)
        escalate("normal", "mehr Suchen als für FAST vorgesehen");
      else if (turn.reads > MAX_FAST_READS)
        escalate("normal", "mehr Reads als für FAST vorgesehen");
    }
  });

  pi.on("agent_end", () => {
    const state = turn;
    if (!state) return;
    turn = undefined;
    const current = pi.getThinkingLevel();
    // Manuelle Änderung während des Turns hat Vorrang: nur zurücksetzen,
    // wenn das Level noch dem selbst gesetzten entspricht.
    if (
      state.autoThinking !== undefined &&
      state.startedThinking &&
      current === state.autoThinking &&
      current !== state.startedThinking
    ) {
      expectAutoThinking(state.startedThinking);
      pi.setThinkingLevel(
        state.startedThinking as ReturnType<typeof pi.getThinkingLevel>,
      );
    }
    clearAutoThinking();
    pi.appendEntry(TASK_TIER_ENTRY, {
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      tier: state.tier,
      escalations: state.escalations,
      searches: state.searches,
      reads: state.reads,
      dupReadsBlocked: state.dupReadsBlocked,
      edits: state.edits,
      commands: state.commands,
      subagentCalls: state.subagentCalls,
      verifierCalls: state.verifierCalls,
      thinking: state.autoThinking ?? state.startedThinking ?? null,
      durationMs: Date.now() - state.startedAt,
    });
  });
}
