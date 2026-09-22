import type { Confidence, ConceptProgress, LearningAttempt } from "./types.ts";

export const MIN_SCORE = -20;
export const MAX_SCORE = 20;

export function scoreDelta(correct: boolean, confidence: Confidence): number {
  if (!Number.isInteger(confidence) || confidence < 0 || confidence > 3) {
    throw new Error("Confidence muss zwischen 0 und 3 liegen.");
  }
  if (correct) return confidence;
  return -(confidence + 1);
}

export function boundedScore(score: number): number {
  return Math.max(MIN_SCORE, Math.min(MAX_SCORE, score));
}

export function emptyConceptProgress(): ConceptProgress {
  return {
    score: 0,
    attempts: 0,
    correct: 0,
    skipped: 0,
    lastSeen: 0,
  };
}

export function applyAttemptToConcept(
  current: ConceptProgress | undefined,
  attempt: LearningAttempt,
): ConceptProgress {
  const next = {
    ...(current ?? emptyConceptProgress()),
    lastSeen: attempt.timestamp,
  };
  if (attempt.outcome === "skipped") {
    next.skipped += 1;
    return next;
  }

  if (attempt.correct === undefined || attempt.confidence === undefined) {
    throw new Error("Beantwortete Lernversuche benötigen Ergebnis und Confidence.");
  }
  next.score = boundedScore(
    next.score + scoreDelta(attempt.correct, attempt.confidence),
  );
  next.attempts += 1;
  if (attempt.correct) next.correct += 1;
  next.lastCorrect = attempt.correct;
  next.lastConfidence = attempt.confidence;
  return next;
}
