import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type {
  Confidence,
  LearningCandidate,
  LearningQuestion,
} from "./types.ts";

export const SKIP_LABEL = "Überspringen";
const CONFIDENCE_OPTIONS = [
  "0 – geraten",
  "1 – glaube ich",
  "2 – ziemlich sicher",
  "3 – weiß ich",
] as const;

export type QuizResult =
  | { outcome: "skipped" }
  | {
      outcome: "answered";
      questionId: string;
      concept: LearningQuestion["concept"];
      correct: boolean;
      confidence: Confidence;
    }
  | { outcome: "cancelled" };

function compactLine(text: string, maxLength = 180): string {
  const normalized = text.replace(/\t/g, "  ");
  return normalized.length <= maxLength
    ? normalized
    : normalized.slice(0, Math.max(1, maxLength - 1)) + "…";
}

export function formatLearningHunk(
  candidate: LearningCandidate,
  maxLines = 10,
): string {
  const header = `@@ -${candidate.hunk.oldStart},${candidate.hunk.oldCount} +${candidate.hunk.newStart},${candidate.hunk.newCount} @@`;
  const lines = candidate.hunk.lines.slice(0, maxLines).map((line) => {
    const prefix =
      line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " ";
    return `${prefix} ${compactLine(line.text)}`;
  });
  if (candidate.hunk.lines.length > maxLines) lines.push("…");
  return [header, ...lines].join("\n");
}

export function confidenceFromLabel(value: string): Confidence | undefined {
  const index = CONFIDENCE_OPTIONS.indexOf(
    value as (typeof CONFIDENCE_OPTIONS)[number],
  );
  return index >= 0 ? (index as Confidence) : undefined;
}

export async function runLearningQuiz(
  candidate: LearningCandidate,
  question: LearningQuestion,
  ctx: Pick<ExtensionContext, "ui">,
): Promise<QuizResult> {
  ctx.ui.notify(
    `Diff Learning · ${candidate.path}\n${formatLearningHunk(candidate)}`,
    "info",
  );
  const selected = await ctx.ui.select(
    question.prompt,
    [...question.options.map((option) => option.label), SKIP_LABEL],
  );
  if (!selected || selected === SKIP_LABEL) return { outcome: "skipped" };

  const answer = question.options.find((option) => option.label === selected);
  if (!answer) return { outcome: "cancelled" };
  const confidenceLabel = await ctx.ui.select(
    "Wie sicher bist du?",
    [...CONFIDENCE_OPTIONS],
  );
  if (!confidenceLabel) return { outcome: "cancelled" };
  const confidence = confidenceFromLabel(confidenceLabel);
  if (confidence === undefined) return { outcome: "cancelled" };

  ctx.ui.notify(
    `${answer.correct ? "Richtig" : "Nicht ganz"}.\nLösung: ${question.options.find((option) => option.correct)?.label ?? "nicht verfügbar"}\n${question.explanation}`,
    answer.correct ? "info" : "warning",
  );
  return {
    outcome: "answered",
    questionId: question.id,
    concept: question.concept,
    correct: answer.correct,
    confidence,
  };
}
