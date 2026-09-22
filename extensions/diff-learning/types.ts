import type { DiffHunk } from "../diff-viewer/types.ts";

export const LEARNING_CONCEPTS = [
  "diff-basics",
  "condition-if",
  "condition-and",
  "condition-or",
  "negation",
  "return",
  "throw",
  "try-catch",
  "fallback",
  "permission-change",
  "guard-removal",
  "test-expectation",
  "validation",
] as const;

export type LearningConcept = (typeof LEARNING_CONCEPTS)[number];

export type Confidence = 0 | 1 | 2 | 3;

export interface LearningCandidate {
  id: string;
  path: string;
  toolName: string;
  timestamp: number;
  hunk: DiffHunk;
  concepts: LearningConcept[];
  learningValue: number;
}

export interface QuestionOption {
  id: string;
  label: string;
  correct: boolean;
}

export interface LearningQuestion {
  id: string;
  concept: LearningConcept;
  prompt: string;
  options: QuestionOption[];
  explanation: string;
}

export interface LearningAttempt {
  concept: LearningConcept;
  questionId: string;
  timestamp: number;
  outcome: "answered" | "skipped";
  correct?: boolean;
  confidence?: Confidence;
}

export interface ConceptProgress {
  score: number;
  attempts: number;
  correct: number;
  skipped: number;
  lastSeen: number;
  lastCorrect?: boolean;
  lastConfidence?: Confidence;
}

export interface ProgressProfile {
  version: 1;
  concepts: Partial<Record<LearningConcept, ConceptProgress>>;
  attempts: LearningAttempt[];
}

export const MAX_PROGRESS_ATTEMPTS = 200;
