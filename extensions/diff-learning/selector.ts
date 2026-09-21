import type { LearningCandidate, ProgressProfile } from "./types.ts";

function conceptScore(
  candidate: LearningCandidate,
  profile: ProgressProfile,
): number {
  return Math.min(
    ...candidate.concepts.map(
      (concept) => profile.concepts[concept]?.score ?? 0,
    ),
  );
}

function hasStrongMisconception(
  candidate: LearningCandidate,
  profile: ProgressProfile,
): boolean {
  return candidate.concepts.some((concept) => {
    const progress = profile.concepts[concept];
    return progress?.lastCorrect === false && (progress.lastConfidence ?? 0) >= 2;
  });
}

export function candidatePriority(
  candidate: LearningCandidate,
  profile: ProgressProfile,
): number {
  const weakness = -conceptScore(candidate, profile) * 1_000;
  const misconception = hasStrongMisconception(candidate, profile) ? 100_000 : 0;
  const compactness = Math.max(0, 100 - candidate.hunk.lines.length);
  return misconception + weakness + candidate.learningValue * 10 + compactness;
}

/** Deterministic candidate selection with an explicit no-immediate-repeat set. */
export function selectCandidate(
  candidates: readonly LearningCandidate[],
  profile: ProgressProfile,
  excludedIds: ReadonlySet<string> = new Set(),
): LearningCandidate | undefined {
  return [...candidates]
    .filter(
      (candidate) =>
        candidate.concepts.length > 0 && !excludedIds.has(candidate.id),
    )
    .sort((left, right) => {
      const priorityDifference =
        candidatePriority(right, profile) - candidatePriority(left, profile);
      if (priorityDifference !== 0) return priorityDifference;
      if (left.timestamp !== right.timestamp) {
        return left.timestamp - right.timestamp;
      }
      return left.id.localeCompare(right.id);
    })[0];
}
