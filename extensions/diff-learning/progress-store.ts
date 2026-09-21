import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { applyAttemptToConcept } from "./scoring.ts";
import {
  LEARNING_CONCEPTS,
  MAX_PROGRESS_ATTEMPTS,
  type Confidence,
  type LearningAttempt,
  type LearningConcept,
  type ProgressProfile,
} from "./types.ts";

export const PROGRESS_SCHEMA_VERSION = 1 as const;

export interface ProgressLoadResult {
  profile: ProgressProfile;
  warning?: string;
  created: boolean;
}

export interface ProgressSaveResult {
  profile: ProgressProfile;
  warning?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isConcept(value: unknown): value is LearningConcept {
  return (
    typeof value === "string" &&
    (LEARNING_CONCEPTS as readonly string[]).includes(value)
  );
}

function isConfidence(value: unknown): value is Confidence {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 3
  );
}

export function emptyProgress(): ProgressProfile {
  return { version: PROGRESS_SCHEMA_VERSION, concepts: {}, attempts: [] };
}

function parseConceptProgress(value: unknown) {
  if (!isRecord(value)) throw new Error("concept progress ist kein Objekt");
  const numbers = [
    "score",
    "attempts",
    "correct",
    "skipped",
    "lastSeen",
  ];
  for (const key of numbers) {
    const candidate = value[key];
    if (
      typeof candidate !== "number" ||
      !Number.isFinite(candidate) ||
      !Number.isInteger(candidate)
    ) {
      throw new Error(`concept progress.${key} ist ungültig`);
    }
  }
  if (
    value.lastCorrect !== undefined &&
    typeof value.lastCorrect !== "boolean"
  ) {
    throw new Error("concept progress.lastCorrect ist ungültig");
  }
  if (
    value.lastConfidence !== undefined &&
    !isConfidence(value.lastConfidence)
  ) {
    throw new Error("concept progress.lastConfidence ist ungültig");
  }
  return {
    score: Math.max(-20, Math.min(20, value.score as number)),
    attempts: Math.max(0, value.attempts as number),
    correct: Math.max(0, value.correct as number),
    skipped: Math.max(0, value.skipped as number),
    lastSeen: Math.max(0, value.lastSeen as number),
    ...(value.lastCorrect !== undefined
      ? { lastCorrect: value.lastCorrect as boolean }
      : {}),
    ...(value.lastConfidence !== undefined
      ? { lastConfidence: value.lastConfidence as Confidence }
      : {}),
  };
}

function parseAttempt(value: unknown): LearningAttempt {
  if (!isRecord(value) || !isConcept(value.concept)) {
    throw new Error("attempt concept ist ungültig");
  }
  if (
    typeof value.questionId !== "string" ||
    value.questionId.length === 0 ||
    !Number.isFinite(value.timestamp)
  ) {
    throw new Error("attempt Metadaten sind ungültig");
  }
  if (value.outcome === "skipped") {
    return {
      concept: value.concept,
      questionId: value.questionId,
      timestamp: value.timestamp as number,
      outcome: "skipped",
    };
  }
  if (
    value.outcome !== "answered" ||
    typeof value.correct !== "boolean" ||
    !isConfidence(value.confidence)
  ) {
    throw new Error("beantworteter attempt ist ungültig");
  }
  return {
    concept: value.concept,
    questionId: value.questionId,
    timestamp: value.timestamp as number,
    outcome: "answered",
    correct: value.correct,
    confidence: value.confidence,
  };
}

export function parseProgress(value: unknown): ProgressProfile {
  if (!isRecord(value) || value.version !== PROGRESS_SCHEMA_VERSION) {
    throw new Error("unbekannte Diff-Learning-Schema-Version");
  }
  if (!isRecord(value.concepts) || !Array.isArray(value.attempts)) {
    throw new Error("Diff-Learning-Profil hat eine ungültige Struktur");
  }
  const concepts: ProgressProfile["concepts"] = {};
  for (const [concept, progress] of Object.entries(value.concepts)) {
    if (!isConcept(concept)) throw new Error(`unbekanntes Konzept: ${concept}`);
    concepts[concept] = parseConceptProgress(progress);
  }
  const attempts = value.attempts
    .slice(-MAX_PROGRESS_ATTEMPTS)
    .map(parseAttempt);
  return { version: PROGRESS_SCHEMA_VERSION, concepts, attempts };
}

export function applyAttempt(
  profile: ProgressProfile,
  attempt: LearningAttempt,
): ProgressProfile {
  const next: ProgressProfile = {
    version: PROGRESS_SCHEMA_VERSION,
    concepts: { ...profile.concepts },
    attempts: [...profile.attempts, attempt].slice(-MAX_PROGRESS_ATTEMPTS),
  };
  next.concepts[attempt.concept] = applyAttemptToConcept(
    profile.concepts[attempt.concept],
    attempt,
  );
  return next;
}

export function defaultProgressPath(): string {
  return join(getAgentDir(), "diff-learning", "progress.json");
}

export class ProgressStore {
  private profile: ProgressProfile = emptyProgress();
  private writeBlocked = false;

  constructor(private readonly filePath: string = defaultProgressPath()) {}

  get path(): string {
    return this.filePath;
  }

  get current(): ProgressProfile {
    return this.profile;
  }

  initialize(): ProgressLoadResult {
    if (!existsSync(this.filePath)) {
      this.writeBlocked = false;
      this.profile = emptyProgress();
      const saved = this.save();
      return {
        profile: this.profile,
        created: true,
        ...(saved.warning ? { warning: saved.warning } : {}),
      };
    }

    try {
      this.writeBlocked = false;
      this.profile = parseProgress(
        JSON.parse(readFileSync(this.filePath, "utf8")) as unknown,
      );
      return { profile: this.profile, created: false };
    } catch (error) {
      this.writeBlocked = true;
      this.profile = emptyProgress();
      return {
        profile: this.profile,
        created: false,
        warning: `Diff-Learning-Profil konnte nicht gelesen werden; die Datei wurde nicht überschrieben: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  record(attempt: LearningAttempt): ProgressSaveResult {
    const next = applyAttempt(this.profile, attempt);
    this.profile = next;
    return this.save();
  }

  save(): ProgressSaveResult {
    if (this.writeBlocked) {
      return {
        profile: this.profile,
        warning:
          "Diff-Learning-Speicherung bleibt gesperrt, weil das vorhandene Profil beschädigt oder unbekannt versioniert ist.",
      };
    }
    const directory = dirname(this.filePath);
    const temporaryPath = `${this.filePath}.tmp-${process.pid}-${Date.now()}-${randomUUID()}`;
    try {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      writeFileSync(
        temporaryPath,
        JSON.stringify(this.profile, null, 2) + "\n",
        { encoding: "utf8", mode: 0o600 },
      );
      renameSync(temporaryPath, this.filePath);
      return { profile: this.profile };
    } catch (error) {
      try {
        rmSync(temporaryPath, { force: true });
      } catch {
        // Preserve the original persistence error for the caller.
      }
      return {
        profile: this.profile,
        warning: `Diff-Learning-Profil konnte nicht gespeichert werden: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
