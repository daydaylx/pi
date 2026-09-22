import { join } from "node:path";
import {
  getAgentDir,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { catalogDescription } from "../shared/command-catalog.ts";
import {
  DIFF_VIEWER_CHANGE_EVENT,
  isDiffViewerChangeEvent,
} from "../shared/diff-events.ts";
import { classifyChange } from "./classifier.ts";
import { buildQuestion } from "./question-bank.ts";
import {
  defaultProgressPath,
  emptyProgress,
  ProgressStore,
  type ProgressSaveResult,
} from "./progress-store.ts";
import { runLearningQuiz } from "./quiz.ts";
import { selectCandidate } from "./selector.ts";
import {
  LEARNING_CONCEPTS,
  type LearningAttempt,
  type LearningCandidate,
  type ProgressProfile,
} from "./types.ts";

const STATUS_KEY = "diff-learning";
const MAX_CANDIDATES_PER_TURN = 32;
const MAX_RECENT_CANDIDATES = 32;

function answeredAttempts(profile: ProgressProfile): LearningAttempt[] {
  return profile.attempts.filter(
    (attempt) => attempt.outcome === "answered",
  );
}

function formatProgress(profile: ProgressProfile, weakOnly: boolean): string {
  const answered = answeredAttempts(profile);
  const correct = answered.filter((attempt) => attempt.correct).length;
  const skipped = profile.attempts.length - answered.length;
  const rows = LEARNING_CONCEPTS.map((concept) => ({
    concept,
    progress: profile.concepts[concept],
  }))
    .filter(({ progress }) => !weakOnly || (progress?.score ?? 0) < 0)
    .sort((left, right) => {
      const scoreDifference =
        (left.progress?.score ?? 0) - (right.progress?.score ?? 0);
      return scoreDifference !== 0
        ? scoreDifference
        : left.concept.localeCompare(right.concept);
    });

  const header = `Diff Learning: ${answered.length} beantwortet, ${correct} richtig, ${skipped} übersprungen.`;
  const details = rows.map(({ concept, progress }) => {
    const score = progress?.score ?? 0;
    const attempts = progress?.attempts ?? 0;
    const misconception =
      progress?.lastCorrect === false && (progress.lastConfidence ?? 0) >= 2
        ? " · Fehlvorstellung"
        : "";
    return `  ${concept}: Score ${score}, ${attempts} beantwortet${misconception}`;
  });
  if (details.length === 0) {
    return `${header}\n  Keine schwachen Konzepte.`;
  }
  return [header, ...details].join("\n");
}

function progressWarning(ctx: ExtensionContext, result: ProgressSaveResult): void {
  if (result.warning && ctx.hasUI) ctx.ui.notify(result.warning, "warning");
}

export default function diffLearningExtension(pi: ExtensionAPI): void {
  let enabled = false;
  let activeContext: ExtensionContext | undefined;
  let progress = emptyProgress();
  let store: ProgressStore | undefined;
  let candidates: LearningCandidate[] = [];
  let recentCandidateIds = new Set<string>();
  let quizInFlight = false;
  let settledWaitingForSubagents = false;
  let activeAsyncSubagents = 0;
  let unsubscribeBus: Array<() => void> = [];

  function clearCandidates(): void {
    candidates = [];
    settledWaitingForSubagents = false;
  }

  function updateStatus(ctx: ExtensionContext, value = enabled): void {
    if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, value ? "LEARN ●" : undefined);
  }

  function ensureStore(): ProgressStore {
    if (!store) store = new ProgressStore(defaultProgressPath());
    return store;
  }

  function setEnabled(ctx: ExtensionContext, value: boolean): void {
    enabled = value;
    updateStatus(ctx);
    if (ctx.hasUI) {
      ctx.ui.notify(
        `Diff Learning ${enabled ? "aktiviert" : "deaktiviert"}.`,
        "info",
      );
    }
  }

  function rememberCandidate(id: string): void {
    recentCandidateIds.add(id);
    if (recentCandidateIds.size <= MAX_RECENT_CANDIDATES) return;
    recentCandidateIds = new Set(
      [...recentCandidateIds].slice(-MAX_RECENT_CANDIDATES),
    );
  }

  async function quizAfterSettled(ctx: ExtensionContext): Promise<void> {
    if (quizInFlight) return;
    if (!settledWaitingForSubagents) return;
    settledWaitingForSubagents = false;

    const turnCandidates = candidates;
    candidates = [];
    if (
      !enabled ||
      ctx.mode !== "tui" ||
      !ctx.hasUI ||
      !ctx.isIdle() ||
      ctx.hasPendingMessages?.() ||
      activeAsyncSubagents > 0
    ) {
      return;
    }

    const candidate = selectCandidate(
      turnCandidates,
      progress,
      recentCandidateIds,
    );
    if (!candidate) return;
    const question = buildQuestion(candidate);
    if (!question) return;

    rememberCandidate(candidate.id);
    quizInFlight = true;
    try {
      const result = await runLearningQuiz(candidate, question, ctx);
      if (result.outcome === "cancelled") return;
      const attempt: LearningAttempt =
        result.outcome === "skipped"
          ? {
              concept: question.concept,
              questionId: question.id,
              timestamp: Date.now(),
              outcome: "skipped",
            }
          : {
              concept: result.concept,
              questionId: result.questionId,
              timestamp: Date.now(),
              outcome: "answered",
              correct: result.correct,
              confidence: result.confidence,
            };
      const saved = ensureStore().record(attempt);
      progress = saved.profile;
      progressWarning(ctx, saved);
    } catch (error) {
      if (ctx.hasUI) {
        ctx.ui.notify(
          `Diff Learning konnte die Frage nicht abschließen: ${error instanceof Error ? error.message : String(error)}`,
          "warning",
        );
      }
    } finally {
      quizInFlight = false;
    }
  }

  function subscribeSessionBus(): void {
    for (const unsubscribe of unsubscribeBus) unsubscribe();
    unsubscribeBus = [];
    unsubscribeBus.push(
      pi.events.on(DIFF_VIEWER_CHANGE_EVENT, (value) => {
        if (!enabled || !isDiffViewerChangeEvent(value)) return;
        const next = classifyChange(value);
        if (next.length === 0) return;
        candidates = [...candidates, ...next].slice(-MAX_CANDIDATES_PER_TURN);
      }),
    );
    unsubscribeBus.push(
      pi.events.on("subagent:async-started", () => {
        activeAsyncSubagents += 1;
      }),
    );
    unsubscribeBus.push(
      pi.events.on("subagent:async-complete", () => {
        activeAsyncSubagents = Math.max(0, activeAsyncSubagents - 1);
        if (activeAsyncSubagents === 0 && settledWaitingForSubagents) {
          const ctx = activeContext;
          if (ctx) void quizAfterSettled(ctx);
        }
      }),
    );
  }

  pi.on("session_start", (_event, ctx) => {
    activeContext = ctx;
    enabled = false;
    clearCandidates();
    recentCandidateIds = new Set();
    quizInFlight = false;
    activeAsyncSubagents = 0;
    store = new ProgressStore(
      join(getAgentDir(), "diff-learning", "progress.json"),
    );
    const loaded = store.initialize();
    progress = loaded.profile;
    updateStatus(ctx, false);
    if (loaded.warning && ctx.hasUI) ctx.ui.notify(loaded.warning, "warning");
    subscribeSessionBus();
  });

  pi.on("agent_start", () => {
    clearCandidates();
  });

  pi.on("agent_settled", async (_event, ctx) => {
    settledWaitingForSubagents = true;
    if (activeAsyncSubagents === 0) await quizAfterSettled(ctx);
  });

  pi.on("session_before_switch", () => clearCandidates());
  pi.on("session_before_fork", () => clearCandidates());
  pi.on("session_before_tree", () => clearCandidates());

  pi.on("session_shutdown", (_event, ctx) => {
    clearCandidates();
    enabled = false;
    quizInFlight = false;
    activeAsyncSubagents = 0;
    for (const unsubscribe of unsubscribeBus) unsubscribe();
    unsubscribeBus = [];
    if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, undefined);
    activeContext = undefined;
    store = undefined;
    progress = emptyProgress();
  });

  pi.registerCommand("learn-diff", {
    description: catalogDescription("learn-diff"),
    handler: async (args, ctx: ExtensionCommandContext) => {
      const command = args.trim().toLowerCase();
      if (command === "" || command === "toggle") {
        setEnabled(ctx, !enabled);
        return;
      }
      if (command === "on" || command === "review") {
        setEnabled(ctx, true);
        return;
      }
      if (command === "off") {
        setEnabled(ctx, false);
        return;
      }
      if (command === "stats" || command === "weak") {
        ctx.ui.notify(formatProgress(progress, command === "weak"), "info");
        return;
      }
      ctx.ui.notify(
        "Nutzung: /learn-diff [on|off|stats|weak|review] (ohne Argument: Toggle)",
        "error",
      );
    },
  });
}
